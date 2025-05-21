import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import escape from 'regexp.escape';

// Specifing the file allows vitest to detect changes in the source files in watch mode:
import worker, { FIXED, DEFAULTS } from "./worker.js";

// Multiple destination scenarios with normal conditions where:
// - message.forward mock doesn't throw any exceptions
// - nothing pathological
//  
describe('multiple destination scenarios', () => {
    const context = {};
    const TEST = {
        ...DEFAULTS,
        CONSOLE_OUTPUT_LEVEL: '0',
        USE_STORED_ADDRESS_CONFIGURATION: "true",
        USE_STORED_USER_CONFIGURATION: "true",
        REJECT_TREATMENT: 'default reject reason'
    };
    const message = {
        from: 'random@internet.com',
        forward: (to, headers) => JSON.stringify({ to, headers }),
        setReject: (reason) => reason,
        to: undefined,
        headers: {
            get: (headerName) => {
                const mockHeaders = {
                    'Message-ID': 'h9MTV7vNalV3',
                    'Date': 'Wed, 30 Oct 2024 15:30:00 +0000'
                };
                return mockHeaders[headerName];
            }
        },
        raw: null,
        rawSize: null,
    };
    const forward = vi.spyOn(message, 'forward');
    const setReject = vi.spyOn(message, 'setReject');

    beforeEach(async () => {
        message.to = null;
    });

    afterEach(async () => {
        vi.clearAllMocks();
        vi.resetAllMocks();
    });

    const failHeaders = new Headers({ [TEST.CUSTOM_HEADER]: TEST.CUSTOM_HEADER_FAIL });
    const passHeaders = new Headers({ [TEST.CUSTOM_HEADER]: TEST.CUSTOM_HEADER_PASS });

    // Reference test data
    const r = {
        user1: 'user1',
        dest1a: 'user1a@email.com',
        dest1b: 'user1b@email.com',
        rejectDest1a: 'user1+spam1a@email.com',
        rejectDest1b: 'user1+spam1b@email.com',
    };

    describe('destination validation', () => {
        const MAP = new Map();
        MAP.set('@SUBADDRESSES', 'subA');
        MAP.set('@REJECT_TREATMENT', r.rejectReason);
        MAP.set(r.user1,
            `,${r.dest1a} , userbeforespace @domain, missingdomain, , missing domain, ${r.dest1b},  ${r.dest1a};`
            + `,${r.rejectDest1a} , userbeforespace @domain, missingdomain, , missing domain, ${r.rejectDest1b},  ${r.rejectDest1a}`
        );
        const environment = { ...TEST, MAP };
        it.each([
            ['user1+subA@domain.com', r.dest1a, r.dest1b,],
        ])('%s should forward to %s and %s', async (to, dest1, dest2) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user1+subB@domain.com', r.rejectDest1a, r.rejectDest1b,],
        ])('%s should reject forward to %s and %s', async (to, dest1, dest2) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, failHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, failHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('conifiguration by KV', () => {
        const MAP = new Map();
        MAP.set('@SUBADDRESSES', 'subA');
        MAP.set('@REJECT_TREATMENT', 'No such recipient');
        MAP.set('user1', `${r.dest1a}, ${r.dest1b}; `
            + `${r.rejectDest1a}, ${r.rejectDest1b}`);
        const environment = { ...TEST, MAP };

        it.each([
            ['user1+subA@domain.com',
                r.dest1a,
                r.dest1b,
            ],
        ])('%s (forwards to %s)||(forwards to %s)', async (to, dest1, dest2) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user1+subB@domain.com',
                r.rejectDest1a,
                r.rejectDest1b,
            ],
        ])('%s (reject forwards to %s)||(reject forwards to %s)', async (to, dest1, dest2) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, failHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, failHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });
    });
});