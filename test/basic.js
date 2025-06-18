import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Common test utilities and resources
import { message, r } from "./test/common.js";

// Specifing the file allows vitest to detect changes in the source files in watch mode:
import worker, { DEFAULTS } from "./src/worker.js";

// Basic scenarios where:
// - message.forward mock doesn't throw any exceptions
// - nothing pathological
//  
describe('basic scenarios', () => {
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

    describe('defaults', () => {
        const environment = { ...TEST };

        it.each([
            ['user1@domain.com', environment.REJECT_TREATMENT],
            ['user1+subA@domain.com', environment.REJECT_TREATMENT],
            ['user2@domain.com', environment.REJECT_TREATMENT],
            ['user2+subA@domain.com', environment.REJECT_TREATMENT],
            ['user2+subB@domain.com', environment.REJECT_TREATMENT],
        ])('%s should reject with "%s"', async (to, reason) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).not.toHaveBeenCalled();
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('configuration by environment variables', () => {

        describe('1 user, any subaddress, 1 PD, reject', () => {
            const environment = {
                ...TEST,
                USERS: r.user1,
                DESTINATION: r.dest
            };

            it.each([
                ['user1@domain.com', r.dest],
                ['user1+subA@domain.com', r.dest],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user2@domain.com', environment.REJECT_TREATMENT],
                ['user2+subA@domain.com', environment.REJECT_TREATMENT],
            ])('%s should reject with "%s"', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });

        describe('multiple users, any subaddress, subaddressed destination, subaddressed reject-forward', () => {
            const environment = {
                ...TEST,
                USERS: 'user1,user2',
                DESTINATION: r.destSubaddressed,
                REJECT_TREATMENT: r.rejectDestSubaddressed
            };

            it.each([
                ['user1@domain.com', `user1${r.destSubaddressed}`],
                ['user1+subA@domain.com', `user1${r.destSubaddressed}`],
                ['user2@domain.com', `user2${r.destSubaddressed}`],
                ['user2+subA@domain.com', `user2${r.destSubaddressed}`],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user3@domain.com', `user3${r.rejectDestSubaddressed}`],
                ['user3+subA@domain.com', `user3${r.rejectDestSubaddressed}`],
            ])('%s should forward to "%s"', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, failHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });

        describe('multiple users, any subaddress, domain destination, domain reject-forward', () => {
            const environment = {
                ...TEST,
                USERS: 'user1,user2',
                DESTINATION: r.destDomain,
                REJECT_TREATMENT: r.rejectDestDomain
            };

            it.each([
                ['user1@domain.com', `user1${r.destDomain}`],
                ['user1+subA@domain.com', `user1${r.destDomain}`],
                ['user2@domain.com', `user2${r.destDomain}`],
                ['user2+subA@domain.com', `user2${r.destDomain}`],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user3@domain.com', `user3${r.rejectDestDomain}`],
                ['user3+subA@domain.com', `user3${r.rejectDestDomain}`],
            ])('%s should forward to "%s"', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, failHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });

        describe('any user, specific subaddresses, 1 PD, custom reject', () => {
            const environment = {
                ...TEST,
                USERS: '*',
                SUBADDRESSES: 'subA,subB,subC+suffix',
                DESTINATION: r.dest,
                REJECT_TREATMENT: r.rejectReason
            };

            it.each([
                ['user1@domain.com', r.dest],
                ['user1+subA@domain.com', r.dest],
                ['user1+subB@domain.com', r.dest],
                ['user1+subC+suffix@domain.com', r.dest],
                ['userN@domain.com', r.dest],
                ['userN+subA@domain.com', r.dest],
                ['userN+subB@domain.com', r.dest],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['userN+subC@domain.com', environment.REJECT_TREATMENT],
                ['userN+subD@domain.com', environment.REJECT_TREATMENT],
            ])('%s should reject with "%s"', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });

        describe('1 user, any subaddress, custom subaddressing separator character, custom forward header', () => {
            const environment = {
                ...TEST,
                USERS: r.user1,
                DESTINATION: r.dest,
                FORMAT_LOCAL_PART_SEPARATOR: '--',
                REJECT_TREATMENT: r.rejectDest,
                CUSTOM_HEADER: 'X-CUSTOM'
            };

            it.each([
                ['user1@domain.com', r.dest],
                ['user1--subA@domain.com', r.dest],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, new Headers({ [environment.CUSTOM_HEADER]: environment.CUSTOM_HEADER_PASS }));
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user1+subA@domain.com', environment.REJECT_TREATMENT],
                ['user2@domain.com', environment.REJECT_TREATMENT],
                ['user2--subA@domain.com', environment.REJECT_TREATMENT],
            ])('%s should forward to "%s"', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, new Headers({ [environment.CUSTOM_HEADER]: environment.CUSTOM_HEADER_FAIL }));
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });

        describe('message local part comparision is case insensitive; destination is case sensitive', () => {
            const environment = {
                ...TEST,
                USERS: r.user1,
                SUBADDRESSES: 'subA',
                DESTINATION: r.destSpecial1
            };

            it.each([
                ['user1@domain.com', r.destSpecial1],
                ['USER1@domain.com', r.destSpecial1],
                ['user1+suba@domain.com', r.destSpecial1],
                ['USER1+SUBA@domain.com', r.destSpecial1],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });
    });

    describe('configuration by KV globals', () => {

        describe('destination validation', () => {
            const MAP = new Map();
            MAP.set('@SUBADDRESSES', 'subA');
            MAP.set('@REJECT_TREATMENT', r.rejectReason);
            MAP.set(r.user1, `;`);
            MAP.set(r.user2, `missingdomain`);
            MAP.set(r.user3, `missingdomain@;missingdomain@`);
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', r.rejectReason],
                ['user1+subA@domain.com', r.rejectReason],
                ['user1+subB@domain.com', r.rejectReason],
                ['user2@domain.com', r.rejectReason],
                ['user2+subA@domain.com', r.rejectReason],
                ['user2+subB@domain.com', r.rejectReason],
                ['user3@domain.com', r.rejectReason],
                ['user3+subA@domain.com', r.rejectReason],
                ['user3+subB@domain.com', r.rejectReason],
            ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });

        describe('1 user, any subaddress, 1 PD, reject', () => {
            const MAP = new Map();
            MAP.set('@USERS', r.user1);
            MAP.set('@DESTINATION', r.dest);
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', r.dest],
                ['user1+subA@domain.com', r.dest],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user2@domain.com', environment.REJECT_TREATMENT],
                ['user2+subA@domain.com', environment.REJECT_TREATMENT],
            ])('%s should reject with "%s"', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });

        describe('multiple users, any subaddress, domain destination, domain reject-forward', () => {
            const MAP = new Map();
            MAP.set('@USERS', 'user1,user2');
            MAP.set('@DESTINATION', r.destDomain);
            MAP.set('@REJECT_TREATMENT', r.rejectDestDomain);
            MAP.set(r.user3, '');
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', `user1${r.destDomain}`],
                ['user1+subA@domain.com', `user1${r.destDomain}`],
                ['user2@domain.com', `user2${r.destDomain}`],
                ['user2+subA@domain.com', `user2${r.destDomain}`],
                ['user3+subA@domain.com', `user3${r.destDomain}`],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user4@domain.com', `user4${r.rejectDestDomain}`],
                ['user4+subA@domain.com', `user4${r.rejectDestDomain}`],
            ])('%s should forward to "%s"', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, failHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });

        describe('multiple users, any subaddress, subaddressed destination, subaddressed reject-forward', () => {
            const MAP = new Map();
            MAP.set('@USERS', 'user1,user2');
            MAP.set('@DESTINATION', r.destSubaddressed);
            MAP.set('@REJECT_TREATMENT', r.rejectDestSubaddressed);
            MAP.set(r.user3, '');
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', `user1${r.destSubaddressed}`],
                ['user1+subA@domain.com', `user1${r.destSubaddressed}`],
                ['user2@domain.com', `user2${r.destSubaddressed}`],
                ['user2+subA@domain.com', `user2${r.destSubaddressed}`],
                ['user3+subA@domain.com', `user3${r.destSubaddressed}`],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user4@domain.com', `user4${r.rejectDestSubaddressed}`],
                ['user4+subA@domain.com', `user4${r.rejectDestSubaddressed}`],
            ])('%s should forward to "%s"', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, failHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });

        describe('any user, specific subaddresses, 1 PD, custom reject', () => {
            const MAP = new Map();
            MAP.set('@USERS', '*');
            MAP.set('@SUBADDRESSES', 'subA,subB,subC+suffix');
            MAP.set('@DESTINATION', r.dest);
            MAP.set('@REJECT_TREATMENT', r.rejectReason);
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', r.dest],
                ['user1+subA@domain.com', r.dest],
                ['user1+subB@domain.com', r.dest],
                ['user1+subC+suffix@domain.com', r.dest],
                ['userN@domain.com', r.dest],
                ['userN+subA@domain.com', r.dest],
                ['userN+subB@domain.com', r.dest],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['userN+subC@domain.com', r.rejectReason],
                ['userN+subD@domain.com', r.rejectReason],
            ])('%s should reject with "%s"', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('configuration by KV users', () => {

        describe('multiple users, any subaddress, user destination, reject', () => {
            const MAP = new Map();
            MAP.set(r.user1, r.dest1);
            MAP.set(r.user2, `${r.dest2};${r.rejectDest2}`);
            MAP.set(r.user3, '');
            const environment = {
                ...TEST,
                DESTINATION: r.dest3,
                MAP
            };

            it.each([
                ['user1@domain.com', r.dest1],
                ['user1+subA@domain.com', r.dest1],
                ['user2@domain.com', r.dest2],
                ['user2+subA@domain.com', r.dest2],
                ['user3@domain.com', r.dest3],
                ['user3+subA@domain.com', r.dest3],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user4@domain.com', environment.REJECT_TREATMENT],
                ['user4+subA@domain.com', environment.REJECT_TREATMENT],
            ])('%s should reject with "%s"', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });

        describe('multiple users, user subaddresses, user destination, mixed error handling', () => {
            const MAP = new Map();
            MAP.set(r.user1, 'user1@email.com');
            MAP.set('user1+', 'subA');
            MAP.set(r.user2, `${r.dest2};${r.rejectDest2}`);
            MAP.set('user2+', 'subA,subB');
            MAP.set(r.user4, `${r.dest4};${r.rejectReason4}`);
            MAP.set('user4+', '+');
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', r.dest1],
                ['user1+subA@domain.com', r.dest1],
                ['user2@domain.com', r.dest2],
                ['user2+subA@domain.com', r.dest2],
                ['user2+subB@domain.com', r.dest2],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user2+subC@domain.com', r.rejectDest2],
            ])('%s should forward to "%s"', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, failHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user1+subB@domain.com', environment.REJECT_TREATMENT],
                ['user3@domain.com', environment.REJECT_TREATMENT],
                ['user3+subA@domain.com', environment.REJECT_TREATMENT],
                ['user4@domain.com', r.rejectReason4],
                ['user4+subA@domain.com', r.rejectReason4],
            ])('%s should reject with "%s"', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('message local part comparision is case insensitive; destination is case sensitive', () => {
        const MAP = new Map();
        MAP.set('@SUBADDRESSES', 'subA');
        MAP.set('@DESTINATION', r.destSpecial1);
        MAP.set(r.user1, '');
        MAP.set(r.user2, r.destSpecial2);
        const environment = { ...TEST, MAP };

        it.each([
            ['user1+suba@domain.com', r.destSpecial1],
            ['USER1+SUBA@domain.com', r.destSpecial1],
            ['user2+suba@domain.com', r.destSpecial2],
            ['USER2+SUBA@domain.com', r.destSpecial2],
        ])('%s should forward to %s', async (to, dest) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest, passHeaders);
            expect(forward).toHaveBeenCalledTimes(1);
            expect(setReject).not.toHaveBeenCalled();
        });
    });

    describe('mixed configuration', () => {

        describe('configuration by KV globals overrides environment variables', () => {
            const MAP = new Map();
            MAP.set('@USERS', r.user2);
            MAP.set('@SUBADDRESSES', 'subA,subB');
            MAP.set('@DESTINATION', r.dest2);
            const environment = {
                ...TEST,
                USERS: r.user1,
                DESTINATION: 'user1@email.com',
                FORMAT_LOCAL_PART_SEPARATOR: '--',
                REJECT_TREATMENT: r.rejectReason,
                CUSTOM_HEADER: 'X-CUSTOM',
                MAP
            };

            it.each([
                ['user1@domain.com', r.rejectReason],
                ['user1--subA@domain.com', r.rejectReason],
            ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });

            it.each([
                ['user2@domain.com', r.dest2],
                ['user2--subA@domain.com', r.dest2],
                ['user2--subB@domain.com', r.dest2],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, new Headers({ [environment.CUSTOM_HEADER]: environment.CUSTOM_HEADER_PASS }));
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user2--subC@domain.com', r.rejectReason],
                ['user2+subA@domain.com', r.rejectReason],
            ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });
        });

        describe('KV users override KV globals', () => {
            const MAP = new Map();
            MAP.set('@USERS', r.user1);
            MAP.set('@SUBADDRESSES', 'subA,subB');
            MAP.set('@DESTINATION', r.dest);
            MAP.set('@REJECT_TREATMENT', r.rejectReason);
            MAP.set(r.user2, r.dest2);
            MAP.set('user2+', 'subC');
            MAP.set(r.user3, `${r.dest3};${r.rejectDest3}`);
            MAP.set(r.user4, r.dest4);
            MAP.set('user4+', '*');
            MAP.set(r.user5, r.dest5);
            MAP.set('user5+', '+*');
            MAP.set(r.user6, r.dest6);
            MAP.set('user6+', '');
            MAP.set(r.user7, r.dest7);
            MAP.set('user7+', '+');
            MAP.set(r.user8, r.dest8);
            MAP.set('user8+', '+ subC,subD');
            const environment = { ...TEST, MAP };

            it.each([
                ['user1@domain.com', r.dest],
                ['user1+subA@domain.com', r.dest],
                ['user1+subB@domain.com', r.dest],
                ['user2@domain.com', r.dest2],
                ['user2+subC@domain.com', r.dest2],
                ['user3@domain.com', r.dest3],
                ['user3+subA@domain.com', r.dest3],
                ['user3+subB@domain.com', r.dest3],
                ['user4@domain.com', r.dest4],
                ['user4+subC@domain.com', r.dest4],
                ['user4+subD@domain.com', r.dest4],
                ['user5+subC@domain.com', r.dest5],
                ['user5+subD@domain.com', r.dest5],
                ['user6@domain.com', r.dest6],
                ['user8+subC@domain.com', r.dest8],
                ['user8+subD@domain.com', r.dest8],
            ])('%s should forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, passHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });

            it.each([
                ['user1+subC@domain.com', r.rejectReason],
                ['user2+subA@domain.com', r.rejectReason],
                ['user2+subB@domain.com', r.rejectReason],
                ['user5@domain.com', r.rejectReason],
                ['user6+subA@domain.com', r.rejectReason],
                ['user6+subB@domain.com', r.rejectReason],
                ['user7@domain.com', r.rejectReason],
                ['user7+subA@domain.com', r.rejectReason],
                ['user7+subB@domain.com', r.rejectReason],
                ['user8@domain.com', r.rejectReason],
                ['user8+subA@domain.com', r.rejectReason],
                ['user8+subB@domain.com', r.rejectReason],
            ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).not.toHaveBeenCalled();
                expect(setReject).toHaveBeenCalledWith(reason);
                expect(setReject).toHaveBeenCalledTimes(1);
            });

            it.each([
                ['user3+subC@domain.com', r.rejectDest3],
            ])('%s should reject forward to %s', async (to, dest) => {
                message.to = to;
                await worker.email(message, environment, context);
                expect(forward).toHaveBeenCalledWith(dest, failHeaders);
                expect(forward).toHaveBeenCalledTimes(1);
                expect(setReject).not.toHaveBeenCalled();
            });
        });
    });

    describe('KV user destination of empty string defaulting to global destination', () => {
        const MAP = new Map();
        MAP.set('@DESTINATION', r.dest);
        MAP.set('@REJECT_TREATMENT', r.rejectReason);
        MAP.set(r.user1, '');
        MAP.set('user1+', 'subA');
        MAP.set(r.user2, ' ');
        MAP.set('user2+', 'subA');
        MAP.set(r.user3, ' ; ');
        MAP.set('user3+', 'subA');
        MAP.set(r.user4, ` ; ${r.rejectReason4}  `);
        MAP.set('user4+', 'subA');
        const environment = { ...TEST, MAP };

        it.each([
            ['user1@domain.com', r.dest],
            ['user1+subA@domain.com', r.dest],
            ['user2@domain.com', r.dest],
            ['user2+subA@domain.com', r.dest],
            ['user3@domain.com', r.dest],
            ['user3+subA@domain.com', r.dest],
            ['user4@domain.com', r.dest],
            ['user4+subA@domain.com', r.dest],
        ])('%s should forward to %s', async (to, dest) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).toHaveBeenCalledWith(dest, passHeaders);
            expect(forward).toHaveBeenCalledTimes(1);
            expect(setReject).not.toHaveBeenCalled();
        });

        it.each([
            ['user1+subB@domain.com', r.rejectReason],
            ['user2+subB@domain.com', r.rejectReason],
            ['user3+subB@domain.com', r.rejectReason],
            ['user4+subB@domain.com', r.rejectReason4],
        ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).not.toHaveBeenCalled();
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });

    describe('prepending of local-part to reject reason', () => {
        const MAP = new Map();
        MAP.set('@USERS', r.user1);
        MAP.set('@SUBADDRESSES', 'subA');
        MAP.set('@REJECT_TREATMENT', ` ${r.rejectReasonNeedingUserPrepend} `);
        MAP.set(r.user1, `${r.dest1};  `);
        MAP.set(r.user2, `${r.dest2};  ${r.rejectReasonNeedingUserPrepend2}`);
        const environment = { ...TEST, MAP };

        it.each([
            ['user1+subB@domain.com', 'user1+subB' + r.rejectReasonNeedingUserPrepend],
        ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).not.toHaveBeenCalled();
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['user2+subB@domain.com', 'user2+subB' + r.rejectReasonNeedingUserPrepend2],
        ])('%s should direct reject with reason \'%s\'', async (to, reason) => {
            message.to = to;
            await worker.email(message, environment, context);
            expect(forward).not.toHaveBeenCalled();
            expect(setReject).toHaveBeenCalledWith(reason);
            expect(setReject).toHaveBeenCalledTimes(1);
        });
    });
});