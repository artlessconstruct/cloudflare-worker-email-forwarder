import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import escape from 'regexp.escape';

// Common test utilities and resources
import { message, r } from "./test/common.js";

// Specifing the file allows vitest to detect changes in the source files in watch mode:
import worker, { FIXED, DEFAULTS } from "./worker.js";

// Failover scenarios
//
describe('failover scenarios', () => {
    const context = {};
    const TEST = {
        ...DEFAULTS,
        CONSOLE_OUTPUT_LEVEL: '0',
        USE_STORED_ADDRESS_CONFIGURATION: "true",
        USE_STORED_USER_CONFIGURATION: "true",
        REJECT_TREATMENT: 'default reject reason',
        UNRECOVERABLE_FORWARD_IMPLEMENTATION_ERROR_MESSAGE: 'Unrecoverable Forward Implementation Error',
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

    const failHeaders = new Headers({ [TEST.CUSTOM_HEADER]: TEST.CUSTOM_HEADER_FAIL });
    const passHeaders = new Headers({ [TEST.CUSTOM_HEADER]: TEST.CUSTOM_HEADER_PASS });

    describe('1 PD, no errors,', () => {
        const environment = {
            ...TEST,
            USERS: r.user,
            DESTINATION: `${r.dest1a}:${r.dest1b}`,
        };

        it.each([
            ['user@domain.com',
                r.dest1a,
                r.dest1b,
            ],
        ])('%s fowards to %s, not to %s', async (to, dest1, dest2) => {
            message.to = to;
            message.forward = vi.fn()
                .mockResolvedValue('forward');
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledTimes(1);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('1 PD, 1 or 2 recoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user,
            DESTINATION: `${r.dest1a}:${r.dest1b}`,
        };

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
            ],
        ])('%s fowards to %s, catches \'%s\', forwards to %s', async (to, dest1, mockErrorMessage, dest2) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValueOnce(new Error(mockErrorMessage))
                .mockResolvedValueOnce();
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s fowards to %s, catches \'%s\', forwards to %s, catches same => throws \'%s\'', async (to, dest1, mockErrorMessage, dest2, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValueOnce(new Error(mockErrorMessage))
                .mockRejectedValueOnce(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('1 PD, 1 or 2 unrecoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user,
            DESTINATION: `${r.dest1a}:${r.dest1b}`,
        };

        it.each([
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
            ],
        ])('%s fowards to %s, catches \'%s\', forwards to %s', async (to, dest1, mockErrorMessage, dest2) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValueOnce(new Error(mockErrorMessage))
                .mockResolvedValueOnce();
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                environment.REJECT_TREATMENT,
            ],
        ])('%s fowards to %s, catches \'%s\', forwards to %s, catches same, direct rejects \'%s\'', async (to, dest1, mockErrorMessage, dest2, reason) => {
            message.to = to;
            message.forward = vi.fn()
                .mockRejectedValueOnce(new Error(mockErrorMessage))
                .mockRejectedValueOnce(new Error(mockErrorMessage));
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('2 PDs, 0, 1 or 2 recoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user,
            DESTINATION: `${r.dest1a}:${r.dest1b}, ${r.dest2a}`,
        };

        it.each([
            ['user@domain.com',
                r.dest1a,
                r.dest1b,
                r.dest2a,
            ],
        ])('%s (fowards to %s; not to %s)||(forwards to %s)', async (to, dest1, dest2, dest3) => {
            message.to = to;
            message.forward = vi.fn()
                .mockResolvedValue();
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s)||(forwards to %s)', async (to, dest1, mockErrorMessage, dest2, dest3) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                r.dest1b,
                r.dest2a,
                recoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s; not to %s)||(forwards to %s, catches \'%s\') => throws \'%s\'', async (to, dest1, dest2, dest3, mockErrorMessage, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest3) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s)||(forwards to %s, catches same) => throws \'%s\'', async (to, dest1, mockErrorMessage, dest2, dest3, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
                if (destination === dest3) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s, catches same)||(forwards to %s, catches same) => throws \'%s\'', async (to, dest1, mockErrorMessage, dest2, dest3, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
                if (destination === dest2) throw new Error(mockErrorMessage);
                if (destination === dest3) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('2 PD, 1 or 2 unrecoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user,
            DESTINATION: `${r.dest1a}:${r.dest1b}, ${r.dest2a}`,
        };

        it.each([
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s)||(forwards to %s)', async (to, dest1, mockErrorMessage, dest2, dest3) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                r.dest1b,
                r.dest2a,
                unrecoverableForwardImplementationErrorMessage
            ],
        ])('%s (fowards to %s; not to %s)||(forwards to %s, catches \'%s\') => accepts', async (to, dest1, dest2, dest3, mockErrorMessage) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest3) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(2);
            expect(setReject).toHaveBeenCalledTimes(0);
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s)||(forwards to %s, catches same) => accepts', async (to, dest1, mockErrorMessage, dest2, dest3) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
                if (destination === dest3) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).toHaveBeenCalledTimes(0);
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
                environment.REJECT_TREATMENT,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s, catches same)||(forwards to %s, catches same) => direct rejects \'%s\'', async (to, dest1, mockErrorMessage, dest2, dest3, reason) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockErrorMessage);
                if (destination === dest2) throw new Error(mockErrorMessage);
                if (destination === dest3) throw new Error(mockErrorMessage);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('2 PDs, 1 or 2 recoverable errors and 1 or 2 unrecoverable errors', () => {
        const environment = {
            ...TEST,
            USERS: r.user,
            DESTINATION: `${r.dest1a}:${r.dest1b}, ${r.dest2a}`,
        };

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                unrecoverableForwardImplementationErrorMessage,
                r.dest2a,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardImplementationErrorMessage,
                r.dest2a,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s, catches \'%s\')||(forwards to %s) => throws \'%s\'', async (to, dest1, mockError1Message, dest2, mockError2Message, dest3, expectedErrorMessage, expectedErrorRegExp) => {
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
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
                recoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s)||(forwards to %s, catches \'%s\') => throws \'%s\'', async (to, dest1, mockError1Message, dest2, dest3, mockError3Message, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination) => {
                if (destination === dest1) throw new Error(mockError1Message);
                if (destination === dest3) throw new Error(mockError3Message);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                r.dest2a,
                unrecoverableForwardImplementationErrorMessage
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s)||(forwards to %s, catches \'%s\') => accepts', async (to, dest1, mockError1Message, dest2, dest3, mockError3Message, reason) => {
            message.to = to;
            message.forward = vi.fn((destination, headers) => {
                if (destination === dest1) throw new Error(mockError1Message);
                if (destination === dest3) throw new Error(mockError3Message);
            });
            const forward = vi.spyOn(message, 'forward');
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).toHaveBeenCalledTimes(0);
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                unrecoverableForwardImplementationErrorMessage,
                r.dest2a,
                recoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardImplementationErrorMessage,
                r.dest2a,
                recoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp,
            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s, catches \'%s\')||(forwards to %s, catches \'%s\') => throws \'%s\'', async (to, dest1, mockError1Message, dest2, mockError2Message, dest3, mockError3Message, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination, headers) => {
                if (destination === dest1) throw new Error(mockError1Message);
                if (destination === dest2) throw new Error(mockError2Message);
                if (destination === dest3) throw new Error(mockError3Message);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user@domain.com',
                r.dest1a,
                recoverableForwardImplementationErrorMessage,
                r.dest1b,
                unrecoverableForwardImplementationErrorMessage,
                r.dest2a,
                unrecoverableForwardImplementationErrorMessage,
                environment.REJECT_TREATMENT,
            ],
            ['user@domain.com',
                r.dest1a,
                unrecoverableForwardImplementationErrorMessage,
                r.dest1b,
                recoverableForwardImplementationErrorMessage,
                r.dest2a,
                unrecoverableForwardImplementationErrorMessage,
                recoverableForwardInterfaceErrorMessage,
                recoverableForwardInterfaceErrorRegExp            ],
        ])('%s (fowards to %s, catches \'%s\'; forwards to %s, catches \'%s\')||(forwards to %s, catches \'%s\') => throws \'%s\'', async (to, dest1, mockError1Message, dest2, mockError2Message, dest3, mockError3Message, expectedErrorMessage, expectedErrorRegExp) => {
            message.to = to;
            message.forward = vi.fn((destination, headers) => {
                if (destination === dest1) throw new Error(mockError1Message);
                if (destination === dest2) throw new Error(mockError2Message);
                if (destination === dest3) throw new Error(mockError3Message);
            });
            const forward = vi.spyOn(message, 'forward');
            await expect(() => worker.email(message, environment, context)).rejects
                .toThrowError(expectedErrorRegExp);
            expect(forward).toHaveBeenCalledWith(dest1, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest2, passHeaders);
            expect(forward).toHaveBeenCalledWith(dest3, passHeaders);
            expect(forward).toHaveBeenCalledTimes(3);
            expect(setReject).toHaveBeenCalledTimes(0);
        });
    });
});