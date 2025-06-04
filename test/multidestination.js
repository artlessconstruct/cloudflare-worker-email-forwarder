import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Specifing the file allows vitest to detect changes in the source files in watch mode:
import worker, {DEFAULTS } from "./worker.js";


// Common test utilities and resources
import { message, r } from "./test/common.js";

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