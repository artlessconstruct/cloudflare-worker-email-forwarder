// Reference test data
export const r = {
    user: 'user',
    dest: 'user@email.com',
    destSubaddressed: '+forwarded@email.com',
    destDomain: '@email.com',
    rejectDest: 'user+spam@email.com',
    rejectDestSubaddressed: '+spam@email.com',
    rejectDestDomain: '@reject.com',
    rejectReason: 'common reject reason',
    rejectReasonNeedingUserPrepend: ': reject reason needing user prepend',
    rejectReasonNeedingUserPrepend2: ': reject reason needing user prepend 2',
    user1: 'user1',
    dest1: 'user1@email.com',
    dest1a: 'user1a@email.com',
    dest1b: 'user1b@email.com',
    rejectDest1: 'user1+spam@email.com',
    rejectDest1a: 'user1+spam1a@email.com',
    rejectDest1b: 'user1+spam1b@email.com',
    rejectReason1: 'reject reason 1',
    user2: 'user2',
    dest2: 'user2@email.com',
    dest2a: 'user2a@email.com',
    dest2b: 'user2b@email.com',
    rejectDest2: 'user2+spam@email.com',
    rejectReason2: 'reject reason 2',
    user3: 'user3',
    dest3: 'user3@email.com',
    rejectDest3: 'user3+spam@email.com',
    rejectReason3: 'reject reason 3',
    user4: 'user4',
    dest4: 'user4@email.com',
    rejectDest4: 'user4+spam@email.com',
    rejectReason4: 'reject reason 4',
    user5: 'user5',
    dest5: 'user5@email.com',
    rejectDest5: 'user5+spam@email.com',
    rejectReason5: 'reject reason 5',
    user6: 'user6',
    dest6: 'user6@email.com',
    rejectDest6: 'user6+spam@email.com',
    rejectReason6: 'reject reason 6',
    user7: 'user7',
    dest7: 'user7@email.com',
    rejectDest7: 'user7+spam@email.com',
    rejectReason7: 'reject reason 7',
    user8: 'user8',
    dest8: 'user8@email.com',
    rejectDest8: 'user8+spam@email.com',
    rejectReason8: 'reject reason 8',
    destSpecial1: 'USER1@email.com',
    destSpecial2: 'USER2@email.com',
};

// Mocked objects
export const headers = {
    'Message-ID': 'test message id',
    'subject': 'test subject',
};

export const message = {
    from: 'random@internet.com',
    forward: (to, headers) => JSON.stringify({ to, headers }),
    setReject: (reason) => reason,
    to: undefined,
    headers: {
        get: (headerName) => {
            return headers[headerName];
        },
        entries: () => {
            return Object.entries(headers);
        },
    },
    raw: null,
    rawSize: 999,
};
