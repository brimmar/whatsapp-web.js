const chai = require('chai');

const { Client } = require('..');

const expect = chai.expect;

function createPage({ pathname, eventBus, socketModel, modules = {} }) {
    const pageWindow = {
        location: { pathname },
        require(name) {
            if (name in modules) return modules[name];
            if (name === 'WAWebBackendEventBus') {
                return eventBus ? { BackendEventBus: eventBus } : null;
            }
            if (name === 'WAWebSocketModel') {
                return socketModel ? { Socket: socketModel } : null;
            }
            if (name === 'WAWebCmd') {
                return { Cmd: { on() {}, off() {} } };
            }
            throw new Error(`Unexpected module: ${name}`);
        },
    };

    const page = {
        async evaluate(fn, ...args) {
            const previousWindow = global.window;
            global.window = pageWindow;
            try {
                return await fn(...args);
            } finally {
                global.window = previousWindow;
            }
        },
        async exposeFunction(name, fn) {
            pageWindow[name] = fn;
        },
    };

    return { page, pageWindow };
}

function configureInjectTest(client, page) {
    const waits = [];

    client.pupPage = page;
    client.setDeviceName = async () => {};
    client.getWWebVersion = async () => '2.3000.1055852612';
    page.waitForFunction = async (_predicate, options) => {
        waits.push(options);
        if (waits.length === 1) return {};
        const state = await page.evaluate(_predicate);
        return {
            jsonValue: async () => state,
        };
    };
    client.requestPairingCode = async () => {};

    return waits;
}

describe('Client authentication compatibility', function () {
    it('uses the backend event bus on the new login route', async function () {
        const events = [];
        const connection = {
            ref: 'qr-ref',
            on() {},
            off() {},
        };
        const eventBus = {
            isMainStreamReadyMd: false,
            socketState: 'UNPAIRED',
            on(event, handler) {
                events.push({ event, handler });
            },
            off() {},
        };
        const { page, pageWindow } = createPage({
            pathname: '/login/',
            eventBus,
            modules: {
                WAWebConnModel: { Conn: connection },
                WAWebSignalStoreApi: {
                    waSignalStore: {
                        async getRegistrationInfo() {
                            return { identityKeyPair: { pubKey: 'identity' } };
                        },
                    },
                },
                WAWebUserPrefsInfoStore: {
                    waNoiseInfo: {
                        async get() {
                            return { staticKeyPair: { pubKey: 'static' } };
                        },
                    },
                },
                WABase64: { encodeB64: (value) => value },
                WAWebUserPrefsMultiDevice: {
                    async getADVSecretKey() {
                        return 'adv';
                    },
                },
                WAWebCompanionRegClientUtils: { DEVICE_PLATFORM: 'WEB' },
            },
        });
        const client = new Client();
        const qrCodes = [];
        client.on('qr', (qr) => qrCodes.push(qr));
        const waits = configureInjectTest(client, page);

        await client.inject();

        expect(waits).to.have.length(2);
        expect(qrCodes).to.deep.equal(['qr-ref,static,identity,adv,WEB']);
        expect(events.map(({ event }) => event)).to.include.members([
            'set_socket_state',
            'open_socket_stream',
        ]);
        expect(pageWindow._wwjsListeners).to.have.length(5);
    });

    it('keeps using the socket model on the normal route', async function () {
        const events = [];
        const socket = {
            state: 'UNPAIRED',
            hasSynced: false,
            on(event, handler) {
                events.push({ event, handler });
            },
            off() {},
        };
        const { page, pageWindow } = createPage({
            pathname: '/',
            socketModel: socket,
        });
        const client = new Client({
            pairWithPhoneNumber: { phoneNumber: '5511999999999' },
        });
        const waits = configureInjectTest(client, page);

        await client.inject();

        expect(waits).to.have.length(2);
        expect(events.map(({ event }) => event)).to.include.members([
            'change:state',
            'change:hasSynced',
        ]);
        expect(pageWindow._wwjsListeners).to.have.length(5);
    });
});
