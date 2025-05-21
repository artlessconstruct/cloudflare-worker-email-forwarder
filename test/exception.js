import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import escape from 'regexp.escape';

// Specifing the file allows vitest to detect changes in the source files in watch mode:
import worker, { FIXED, DEFAULTS } from "./worker.js";

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
        UNRECOVERABLE_FORWARD_IMPLEMENTATION_ERROR_MESSAGE: 'Unrecoverable Forward Implementation Error',
    };
    const message = {
        from: 'random@internet.com',
        forward: undefined,
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
    const recoverableForwardImplementationErrorMessage = FIXED.RECOVERABLE_FORWARD_IMPLEMENTATION_ERROR_MESSAGE_1;
    const unrecoverableForwardImplementationErrorMessage = TEST.UNRECOVERABLE_FORWARD_IMPLEMENTATION_ERROR_MESSAGE;

    // Test subject errors caught
    const recoverableForwardInterfaceErrorMessage = FIXED.RECOVERABLE_FORWARD_INTERFACE_ERROR_MESSAGE;
    const recoverableForwardInterfaceErrorRegExp = new RegExp(`^${escape(recoverableForwardInterfaceErrorMessage)}`);

    // Reference test data
    const r = {
        user: 'user',
        dest: 'user@email.com',
        destDomain: '@email.com',
        rejectDest: 'user+spam@email.com',
        rejectReason: 'common reject reason',
        user1: 'user1',
        dest1: 'user1@email.com',
        dest1a: 'user1a@email.com',
        dest1b: 'user1b@email.com',
        rejectDest1: 'user1+spam@email.com',
        rejectDest1a: 'user1+spam1a@email.com',
        rejectDest1b: 'user1+spam1b@email.com',
        rejectReason1: 'user1 reject reason',
    };

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