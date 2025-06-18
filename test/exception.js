import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import escape from 'regexp.escape';

// Common test utilities and resources
import { message, r } from "./test/common.js";

// Specifing the file allows vitest to detect changes in the source files in watch mode:
import worker, { FIXED, DEFAULTS } from "./src/worker.js";

// Exceptional scnearios:
// - forward mock throwing exceptions due to destinations having either
//     recoverable or unrecoverable errors
// - Pathological 
//
describe('exceptional scenarios', () => {
    const context = {};
    const TEST = {
        ...DEFAULTS,
        CONSOLE_OUTPUT_LEVEL: '0',
        USE_STORED_ADDRESS_CONFIGURATION: "true",
        USE_STORED_USER_CONFIGURATION: "true",
        REJECT_TREATMENT: 'default reject reason',
        CLOUDFLARE_RECOVERABLE_FORWARDING_ERROR_REGEXP: `^(${escape(FIXED.CLOUDFLARE_FORWARDING_TRANSPORT_ERROR_MESSAGE_PREFIX)})`,
        CLOUDFLARE_FORWARDING_UNRECOVERABLE_ERROR_MESSAGE_PREFIX: 'Cloudflare forwarding unrecoverable error',
    };
    const setReject = vi.spyOn(message, 'setReject');

    beforeEach(async () => {
        message.to = null;
        message.forward = null;
    });

    afterEach(async () => {
        vi.clearAllMocks();
        vi.resetAllMocks();
    });

    // Mocked errors injected
    const recoverableForwardImplementationErrorMessage = FIXED.CLOUDFLARE_FORWARDING_TRANSPORT_ERROR_MESSAGE_PREFIX;
    const unrecoverableForwardImplementationErrorMessage = TEST.CLOUDFLARE_FORWARDING_UNRECOVERABLE_ERROR_MESSAGE_PREFIX;

    // Test subject errors caught
    const recoverableForwardInterfaceErrorMessage = FIXED.RECOVERABLE_FORWARD_EXCEPTION_MESSAGE_PREFIX;
    const recoverableForwardInterfaceErrorRegExp = new RegExp(`^${escape(recoverableForwardInterfaceErrorMessage)}`);

    const failHeaders = new Headers({ [TEST.CUSTOM_HEADER]: TEST.CUSTOM_HEADER_FAIL });
    const passHeaders = new Headers({ [TEST.CUSTOM_HEADER]: TEST.CUSTOM_HEADER_PASS });

    describe('1 PD, 1 recoverable error', () => {
        const environment = {
            ...TEST,
            USERS: r.user1,
            DESTINATION: r.dest1,
        };

        it.each([
            ['user1@domain.com', r.dest1,
                recoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s, catches \'%s\') => throws \'%s\'', async (to, dest, mockErrorMessage, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValue(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest, passHeaders);
            expect(forward).toHaveBeenCalledTimes(1);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('1 PD, 1 unrecoverable error', () => {
        const environment = {
            ...TEST,
            USERS: 'user1',
            DESTINATION: 'user1@email.com',
        };

        it.each([
            ['user1@domain.com',
                r.dest1,
                unrecoverableForwardImplementationErrorMessage,
                environment.REJECT_TREATMENT
            ],
        ])('%s (forwards to %s, catches \'%s\') => direct rejects \'%s\'', async (to, dest1, mockErrorMessage, reason) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValue(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledTimes(1);
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('1 PD, reject destination unrecoverable error', () => {
        const environment = {
            ...TEST,
            USERS: r.user1,
            DESTINATION: r.dest1,
            REJECT_TREATMENT: r.rejectDest1,
        };

        it.each([
            ['user2@domain.com',
                r.rejectDest1,
                unrecoverableForwardImplementationErrorMessage,
                FIXED.prepend(DEFAULTS.REJECT_TREATMENT,
                    [{ test: FIXED.startsWithNonAlphanumericRegExp, prepend: 'user2' }]
                )
            ],
        ])('%s (reject forwards to %s, catches \'%s\') => direct rejects with fallback to default reason \'%s\'', async (to, dest1, mockErrorMessage, reason) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValue(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, failHeaders);
            expect(forward).toHaveBeenCalledTimes(1);
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('2 PDs, 1 or two recoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user1,
            DESTINATION: `${r.dest1a}, ${r.dest1b}`,
        };

        it.each([
            ['user1@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (forwards to %s, catches \'%s\')||(forwards to %s) => throws \'%s\'', async (to, dest1, mockErrorMessage, dest2, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user1@domain.com',
                r.dest1a,
                r.dest1b,
                recoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (forwards to %s)||(forwards to %s, catches \'%s\') => throws \'%s\'', async (to, dest1, dest2, mockErrorMessage, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest2) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user1@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (forwards to %s, catches \'%s\')||(forwards to %s, catches same) => throws \'%s\'', async (to, dest1, mockErrorMessage, dest2, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValue(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('2 PDs, 1 or two unrecoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user1,
            DESTINATION: `${r.dest1a}, ${r.dest1b}`,
        };

        it.each([
            ['user1@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b
            ],
        ])('%s (forwards to %s, catches \'%s\')||(forwards to %s)', async (to, dest1, mockErrorMessage, dest2) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).toHaveBeenCalledTimes(0);
        });

        it.each([
            ['user1@domain.com',
                r.dest1a,
                r.dest1b,
                unrecoverableForwardImplementationErrorMessage
            ],
        ])('%s (forwards to %s)||(forwards to %s, catches \'%s\')', async (to, dest1, dest2, mockErrorMessage, reason) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest2) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).toHaveBeenCalledTimes(0);
        });

        it.each([
            ['user1@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                environment.REJECT_TREATMENT
            ],
        ])('%s (forwards to %s, catches \'%s\')||(forwards to %s, catches same) => direct rejects \'%s\'', async (to, dest1, mockErrorMessage, dest2, reason) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValue(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('2 PDs, 1 unrecoverable, 1 recoverable error', () => {
        const environment = {
            ...TEST,
            USERS: r.user1,
            DESTINATION: `${r.dest1a}, ${r.dest1b}`,
        };

        it.each([
            ['user1@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardImplementationErrorMessage,
                environment.REJECT_TREATMENT,
            ],
            ['user1@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                unrecoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (forwards to %s, catches \'%s\')||(forwards to %s, catches \'%s\') => throws \'%s\'', async (to, dest1, mockError1Message, dest2, mockError2Message, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockError1Message);
                if (destination === dest2) throw new Error(mockError2Message);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).toHaveBeenCalledTimes(0);
        });
    });
});