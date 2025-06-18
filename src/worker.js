/**
 * A Cloudflare Email Worker providing configurable email forwarding which
 * routes from email addresses using sub-addressing (a.k.a. RFC 5233 sub-address
 * extension, tagged addresses, plus addresses, etc.) to a set of primary
 * destinations simultaneously, where each such primary destination is a
 * sequence of backup destinations attempted sequentially until one succeeds.
 *
 * Copyright (C) 2024 artlessconstruct
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import escape from 'regexp.escape';

// Fixed configuration for helper functions and for testing

export const FIXED = {

    // Cloudflare ForwardableEmailMessage.forward() exception message prefixes:
    CLOUDFLARE_FORWARDING_INVALID_ADDRESS_MESSAGE_PREFIX: 'destination address is invalid',
    CLOUDFLARE_FORWARDING_UNVERIFIED_ADDRESS_MESSAGE_PREFIX: 'destination address not verified',
    CLOUDFLARE_FORWARDING_DUPLICATE_ADDRESS_MESSAGE_PREFIX: `message already forwarded to this destination`,
    CLOUDFLARE_FORWARDING_SAME_WORKER_ADDRESS_MESSAGE_PREFIX: `cannot forward email to same worker`,
    CLOUDFLARE_FORWARDING_TRANSPORT_ERROR_MESSAGE_PREFIX: 'could not send email',

    // Message prefixes for exception thrown:
    RECOVERABLE_FORWARD_EXCEPTION_MESSAGE_PREFIX: 'forwarding error',

    // Matches if starts with a non-alphanumeric
    startsWithNonAlphanumericRegExp: /^[^A-Z0-9]/i,

    // Prepends to the base with prepend if the regexp matches
    prepend(base, prependConditions) {
        for (const prependCondition of prependConditions) {
            const shouldPrepend =
                typeof prependCondition.test === 'string'
                    && base.startsWith(prependCondition.test)
                || prependCondition.test instanceof RegExp
                && prependCondition.test.test(base);
            if (shouldPrepend)
                return prependCondition.prepend + base;
        }
        return base;
    }
};

class PrimaryDestinationResult {
    constructor(wasSuccessful, hadRecoverableError, successfulDestination, errorMessages, errors) {
        this.wasSuccessful = wasSuccessful;
        this.hadRecoverableError = hadRecoverableError;
        this.successfulDestination = successfulDestination;
        this.errorMessages = errorMessages;
        this.errors = errors;
    }
};

class RecoverableForwardError extends Error {
    constructor(errors) {
        super(FIXED.RECOVERABLE_FORWARD_EXCEPTION_MESSAGE_PREFIX + ": (" + errors.map(e => `"${e.message}"`).join(', ') + ")");
        this.name = 'RecoverableForwardError';
        this.errors = errors;
    }
};

export const DEFAULTS = {
    ///////////////////////////////////////////////////////////////////////////
    // Overrideable only by environment configuration

    // Used to control the level of logging for the consoleOutput method.
    // The level is a number from 0 to 5
    // where 0 is no logging and 5 is debug level logging.
    // 0 = none, 1 = error, 2 = warn, 3 = info, 4 = log, 5 = debug
    CONSOLE_OUTPUT_LEVEL: "2",

    // Control whether different categories of stored configuration will be
    // loaded from the Cloudflare KV-based key-value store
    //
    USE_STORED_ADDRESS_CONFIGURATION: "false",
    USE_STORED_USER_CONFIGURATION: "true",

    ///////////////////////////////////////////////////////////////////////////
    // Overrideable by stored and environment configuration
    // (in priority order)

    // Address configuration
    // If USE_STORED_ADDRESS_CONFIGURATION is enabled then
    // this stored address configuration will be loaded
    //
    DESTINATION: "",
    REJECT_TREATMENT: "Address does not exist",
    SUBADDRESSES: "*",
    USERS: "",

    ///////////////////////////////////////////////////////////////////////////
    // Overrideable only by environment configuration

    // Format configuration
    // REQUIREMENT: The 4 separators
    // - MUST all be different
    // - MUST not be '*' or '@'
    // - MUST not be any character used in a user, sub-address or destination
    //   domain
    // RECOMMENDATION: The primary address, backup address and reject separators SHOULD
    // - be either 
    //     - a space ' ', OR
    //     - one of the special characters '"(),:;<>[\]'
    // which are not allowed in the unquoted local-part of an email address.
    // See [Email address - Wikipedia](https://en.wikipedia.org/wiki/Email_address#Local-part).
    // Quoted local-parts in email addresses are not supported here as it would
    // add complexity and as they are used infrequently not many systems support
    // them in any case.
    //
    FORMAT_PRIMARY_ADDRESS_SEPARATOR: ",",
    FORMAT_BACKUP_ADDRESS_SEPARATOR: ":",
    FORMAT_LOCAL_PART_SEPARATOR: "+",
    FORMAT_REJECT_SEPARATOR: ";",
    FORMAT_VALID_CUSTOM_HEADER_REGEXP: "X-.*",
    // Source: [HTML Standard](https://html.spec.whatwg.org/multipage/input.html#input.email.attrs.value.multiple)
    FORMAT_VALID_EMAIL_ADDRESS_REGEXP: "^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$",

    // Custom header configuration
    //
    CUSTOM_HEADER: "X-My-Email-Forwarding",
    CUSTOM_HEADER_FAIL: "fail",
    CUSTOM_HEADER_PASS: "pass",

    // Error message configuration
    //
    CLOUDFLARE_RECOVERABLE_FORWARDING_ERROR_REGEXP: ".*",

    // Cloudflare KV key-value store
    MAP: new Map(),

    ////////////////////////////////////////////////////////////////////////////
    // Overrideable implementation methods

    // Returns the user and sub-address parts of the local address
    // in lower case
    addressLocalParts(localPart, formatLocalPartSeparator) {
        // 1. Convert to lower case
        // 2. Split this on first instance of formatLocalPartSeparator only
        // into a 2 element array
        const lowerCaseLocalPart = localPart.toLowerCase();
        const firstLocalPartSeparatorIndex = lowerCaseLocalPart.indexOf(formatLocalPartSeparator);
        return firstLocalPartSeparatorIndex >= 0
            ? [lowerCaseLocalPart.slice(0, firstLocalPartSeparatorIndex),
            lowerCaseLocalPart.slice(firstLocalPartSeparatorIndex + formatLocalPartSeparator.length)]
            : [lowerCaseLocalPart, ''];
    },
    // Returns a description of a message 
    emailImage(message) {
        return {
            from: message.from,
            to: message.to,
            size: message.rawSize,
            messageId: message.headers.get('Message-ID'),
            subject: message.headers.get('subject'),
            // allHeaders: Object.fromEntries(message.headers.entries())
        };
    },
    consoleOutput(message, level, configuration) {
        const levelMap = {
            none: 0,
            error: 1,
            warn: 2,
            info: 3,
            log: 4,
            debug: 5,
        };
        if (level in levelMap && configuration.consoleOutputLevel >= levelMap[level]) {
            switch (level) {
                case 'error':
                    console.error(message);
                    break;
                case 'warn':
                    console.warn(message);
                    break;
                case 'info':
                    console.info(message);
                    break;
                case 'log':
                    console.log(message);
                    break;
                case 'debug':
                    console.debug(message);
                    break;
            }
        }
    },
    // Forward to a primaryDestination by attempting to forward to
    // each included backupDestination sequentially the forward is successful.
    // Implementation exceptions are not propagated but aggregated as a 
    // PrimaryDestinationResult which aggregates the results of all forwards
    // attempted.
    async forwardToPrimaryDestination(
        message, primaryDestination, primaryDestinationId, customHeaders, emailImage, configuration) {
        let s = 0;
        let wasSuccessful = false;
        let hadRecoverableError = false;
        let errorMessages = [];
        let errors = [];
        for (const backupDestination of primaryDestination) {
            const backupDestinationId = s + 1;
            const log = (wasSuccessful, errorMessage) => {
                configuration.consoleOutput({
                    email: emailImage,
                    action: 'SimpleForward',
                    primaryDestinationId: primaryDestinationId,
                    backupDestinationId: backupDestinationId,
                    backupDestination: backupDestination,
                    wasSuccessful: wasSuccessful,
                    errorMessage: errorMessage,
                }, (wasSuccessful ? 'log' : 'error'), configuration);
            };
            try {
                await message.forward(backupDestination, customHeaders);
                wasSuccessful = true;
                log(wasSuccessful, null);
                break;
            }
            catch (error) {
                log(wasSuccessful, error.message);
                errorMessages.push({
                    primaryDestinationId: primaryDestinationId,
                    backupDestinationId: backupDestinationId,
                    backupDestination: backupDestination,
                    errorMessage: error.message
                });
                errors.push(error);
                if (configuration.recoverableForwardImplementationErrorRegExp.test(error.message)) {
                    hadRecoverableError = true;
                }
            }
            s++;
        }
        return new PrimaryDestinationResult(
            wasSuccessful,
            hadRecoverableError,
            wasSuccessful ? primaryDestination.at(s) : null,
            errorMessages,
            errors,
        );
    },
    // Forwards to a compoundDestination which is an array of zero or more primary
    // destinations, by simultaneously forwarding to each primary destination.
    // Throws if at least one primary destination had a recoverable error
    // and was not otherwise successful.
    // Otherwise returns successful, which is true if forwarding succeeded to at
    // least one primary destination.
    async forwardToCompoundDestination(message, actionType, compoundDestination, customHeaders, emailImage, configuration) {
        const primaryDestinationResults = await Promise.all(
            compoundDestination.map((primaryDestination, primaryDestinationIndex) =>
                configuration.forwardToPrimaryDestination(
                    message, primaryDestination,
                    primaryDestinationIndex + 1,
                    customHeaders, emailImage, configuration)
            ));
        const hadRecoverableError
            = primaryDestinationResults.map(
                result => (!result.wasSuccessful && result.hadRecoverableError)).some(Boolean);
        const wasSuccessful = !hadRecoverableError
            && primaryDestinationResults.map(
                result => result.wasSuccessful).some(Boolean);
        const successfulDestinations = primaryDestinationResults
            .map(result => result.successfulDestination).filter(Boolean);
        const errorMessages = primaryDestinationResults
            .flatMap(result => result.errorMessages);
        const errors = primaryDestinationResults
            .flatMap(result => result.errors);
        let status = wasSuccessful
            ? 'SuccessfulForwarding'
            : (hadRecoverableError
                ? 'RecoverableErrorForwarding'
                : 'UnrecoverableErrorForwarding');
        configuration.consoleOutput({
            email: emailImage,
            action: actionType,
            compoundDestination: compoundDestination,
            status: status,
            successfulDestinations: successfulDestinations,
            errorMessages: errorMessages
        }, 'info', configuration);
        if (hadRecoverableError) {
            throw new RecoverableForwardError(errors);
        }
        return wasSuccessful;
    },
    isValidEmailAddress(address, validAddressRegExp) {
        return validAddressRegExp.test(address);
    }
};

export default {
    // Handle the forwarding of an email based on the message's `to` attribute. 
    async email(message, environment, context) {
        // Environment-based configuration which overrides `DEFAULTS`
        //
        const {
            CONSOLE_OUTPUT_LEVEL,
            USE_STORED_ADDRESS_CONFIGURATION,
            USE_STORED_USER_CONFIGURATION,

            DESTINATION,
            REJECT_TREATMENT,
            SUBADDRESSES,
            USERS,

            CLOUDFLARE_RECOVERABLE_FORWARDING_ERROR_REGEXP,

            FORMAT_PRIMARY_ADDRESS_SEPARATOR,
            FORMAT_BACKUP_ADDRESS_SEPARATOR,
            FORMAT_LOCAL_PART_SEPARATOR,
            FORMAT_REJECT_SEPARATOR,
            FORMAT_VALID_CUSTOM_HEADER_REGEXP,
            FORMAT_VALID_EMAIL_ADDRESS_REGEXP,

            CUSTOM_HEADER,
            CUSTOM_HEADER_FAIL,
            CUSTOM_HEADER_PASS,

            MAP,

            addressLocalParts,
            emailImage,
            consoleOutput,
            forwardToPrimaryDestination,
            forwardToCompoundDestination,
            isValidEmailAddress
        } = { ...DEFAULTS, ...environment };

        // Helper methods independent of configuration
        //

        function booleanFromString(stringBoolean) {
            return ['true', '1']
                .includes(stringBoolean.trim().toLowerCase());
        }
        async function storedConfigurationValue(shouldLoad, key) {
            // MAP.get(key) returns null if key is not stored so '?? undefined'
            // coalesces null to undefined but leaves '' unchanged
            // which is important because '' is used to indicate that
            // the global configured should be used for that destination
            return shouldLoad ? (await MAP.get(key) ?? undefined) : undefined;
        }

        // Load and validate stored and environment configuration
        //

        const consoleOutputLevel = CONSOLE_OUTPUT_LEVEL;
        const useStoredAddressConfiguration =
            booleanFromString(USE_STORED_ADDRESS_CONFIGURATION);
        const useStoredUserConfiguration =
            booleanFromString(USE_STORED_USER_CONFIGURATION);

        const globalDestination = (
            await storedConfigurationValue(useStoredAddressConfiguration,
                '@DESTINATION')
            ?? DESTINATION
        ).trim();
        const globalRejectTreatment = (
            await storedConfigurationValue(useStoredAddressConfiguration,
                '@REJECT_TREATMENT')
            ?? REJECT_TREATMENT
        ).trim();
        const globalSubaddresses = (
            await storedConfigurationValue(useStoredAddressConfiguration,
                '@SUBADDRESSES')
            ?? SUBADDRESSES
        ).trim().toLowerCase();
        const globalUsers = (
            await storedConfigurationValue(useStoredAddressConfiguration,
                '@USERS')
            ?? USERS
        ).trim().toLowerCase();

        const recoverableForwardImplementationErrorRegExp =
            new RegExp(CLOUDFLARE_RECOVERABLE_FORWARDING_ERROR_REGEXP);

        const formatValidEmailAddressRegExp =
            new RegExp(FORMAT_VALID_EMAIL_ADDRESS_REGEXP);
        const formatValidCustomHeaderRegExp =
            new RegExp(FORMAT_VALID_CUSTOM_HEADER_REGEXP);

        const customHeader =
            validateCustomHeader(CUSTOM_HEADER);
        const customHeaderFail =
            CUSTOM_HEADER_FAIL.trim();
        const customHeaderPass =
            CUSTOM_HEADER_PASS.trim();

        const CONFIGURATION = {
            recoverableForwardImplementationErrorRegExp: recoverableForwardImplementationErrorRegExp,
            consoleOutputLevel: consoleOutputLevel,
            consoleOutput: consoleOutput,
            forwardToPrimaryDestination: forwardToPrimaryDestination,
        };

        // Derived constants
        //

        const startsWithLocalPartSeparatorRegExp =
            new RegExp(`^${escape(FORMAT_LOCAL_PART_SEPARATOR)}`);
        const startsWithLocalPartOrDomainSeparatorRegExp =
            new RegExp(`^(${escape('@')}|${escape(FORMAT_LOCAL_PART_SEPARATOR)})`);

        // Helper methods dependent on configuration
        //

        function validateCustomHeader(customHeader) {
            const customHeaderTrimmed = customHeader.trim();
            if (formatValidCustomHeaderRegExp.test(customHeaderTrimmed))
                return customHeaderTrimmed;
            else
                throw (`Invalid custom header ${customHeaderTrimmed}`);
        }
        // Return an object with valid and invalid backup addresses for a primary
        // destination after
        // - trimming whitespace
        // - prepend the message's user to the destination if it begins with
        //   either FORMAT_LOCAL_PART_SEPARATOR or '@'
        function validatePrimaryDestination(primaryDestinationText) {
            return primaryDestinationText.split(FORMAT_BACKUP_ADDRESS_SEPARATOR).reduce(
                (newPrimaryDestination, basicDestination) => {
                    let backupDestination = FIXED.prepend(basicDestination.trim(),
                        [{ test: FORMAT_LOCAL_PART_SEPARATOR, prepend: messageUser },
                        { test: '@', prepend: messageUser }]
                    );
                    if (isValidEmailAddress(backupDestination, formatValidEmailAddressRegExp)) {
                        newPrimaryDestination.validBackup.push(backupDestination);
                    } else if (backupDestination !== '') {
                        newPrimaryDestination.invalidBackup.push(backupDestination);
                    }
                    return newPrimaryDestination;
                },
                { validBackup: [], invalidBackup: [] }
            );
        }
        function validateCompoundDestination(compoundDestinationText) {
            return compoundDestinationText.split(FORMAT_PRIMARY_ADDRESS_SEPARATOR).reduce(
                (newCompoundDestination, primaryDestinationText) => {
                    const nonDedupedprimaryDestination =
                        validatePrimaryDestination(primaryDestinationText);
                    const dedupedPrimaryDestination = nonDedupedprimaryDestination.validBackup.reduce(
                        (newPrimaryDestination, destination) => {
                            if (!newCompoundDestination.validBackup.includes(destination)) {
                                newCompoundDestination.validBackup.push(destination);
                                newPrimaryDestination.push(destination);
                            } else {
                                newCompoundDestination.duplicateBackup.push(destination);
                            };
                            return newPrimaryDestination;
                        }, []);
                    if (dedupedPrimaryDestination.length > 0)
                        newCompoundDestination.validPrimary.push(dedupedPrimaryDestination);
                    newCompoundDestination.invalidBackup.concat(nonDedupedprimaryDestination.invalidBackup);
                    return newCompoundDestination;
                },
                { validPrimary: [], validBackup: [], invalidBackup: [], duplicateBackup: [] }
            );
        }
        function warnAboutBadDestinations(messageUser, validatedCompoundDestination, destinationType, configuration) {
            [
                {
                    description: 'invalidly formatted',
                    destinations: validatedCompoundDestination.invalidBackup
                },
                {
                    description: 'duplicate',
                    destinations: validatedCompoundDestination.duplicateBackup
                },
            ].map(issue => {
                if (issue.destinations.length > 0)
                    configuration.consoleOutput({
                        messageUser: messageUser,
                        issue: issue.description,
                        destinationType: destinationType,
                        destinations: issue.destinations,
                    }, 'warn', configuration);
            });
        }
        function compoundDestinationImage(validatedCompoundDestination) {
            return validatedCompoundDestination.map(
                primaryDestination =>
                    primaryDestination.join(FORMAT_BACKUP_ADDRESS_SEPARATOR)
            ).join(FORMAT_PRIMARY_ADDRESS_SEPARATOR);
        }

        // Given from RFC 5233 that the email address has the syntax:
        //     `${LocalPart}@${AbsoluteDomain}`
        // and LocalPart has the syntax
        //     `${user}${FORMAT_LOCAL_PART_SEPARATOR}${subaddress}`
        // extract the user and subaddrress
        //
        const messageLocalPart = message.to.split('@')[0];
        const [messageUser, messageSubaddress] = addressLocalParts(messageLocalPart, FORMAT_LOCAL_PART_SEPARATOR);

        // For logging
        const theEmailImage = emailImage(message);

        // If useStoredUserConfiguration
        // load stored user configuration
        // which overrides environment-based configuration (and defaults)
        const userDestinationWithRejectTreatment
            = await storedConfigurationValue(useStoredUserConfiguration, messageUser);
        // An empty string is valid (no sub-addresses allowed) and the ??
        // operator will prevent this value from stored configuration from being
        // overriden as '' ?? x evaluates to ''
        const userSubaddresses =
            (await storedConfigurationValue(
                useStoredUserConfiguration,
                messageUser + FORMAT_LOCAL_PART_SEPARATOR))
                ?.trim().toLowerCase()
            ?? globalSubaddresses;
        const userRequiresSubaddress = userSubaddresses
            .startsWith(FORMAT_LOCAL_PART_SEPARATOR);
        const userConcreteSubaddresses = userSubaddresses
            .replace(startsWithLocalPartSeparatorRegExp, '').trim();

        // Given userDestinationWithRejectTreatment has the syntax:
        //     `${destination}${FORMAT_REJECT_SEPARATOR}${rejectTreatment}`
        // extract destination and rejectTreatment.
        // Empty strings for these constants indicate that the global
        // configuration should override the user configuration
        // and the || operator allows such an override as '' is falsy
        // and so '' || x evaluates to x 
        //
        const userDestination =
            userDestinationWithRejectTreatment?.split(FORMAT_REJECT_SEPARATOR).at(0).trim()
            || globalDestination;
        const userRejectTreatment =
            userDestinationWithRejectTreatment?.split(FORMAT_REJECT_SEPARATOR).at(1)?.trim()
            || globalRejectTreatment;

        // The message user is allowed if:
        // - the specific message user was found in the user store, or
        // - the global user configuration is a wildcard, or
        // - the message user is in the set of allowed global users
        const messageUserIsAllowed =
            userDestinationWithRejectTreatment !== undefined
            || globalUsers === '*'
            || globalUsers.split(FORMAT_PRIMARY_ADDRESS_SEPARATOR)
                .map(s => s.trim()).includes(messageUser);
        // The sub-address is allowed if:
        // - the message user either
        //     - has no sub-address and users do not require one, or
        //     - has a sub-address and the sub-address configuration is either
        //       a wildcard or the user in the set of allowed sub-addresses 
        const messageSubaddressIsAllowed =
            messageSubaddress === ''
                ? !userRequiresSubaddress
                : userConcreteSubaddresses === '*'
                || userConcreteSubaddresses.split(FORMAT_PRIMARY_ADDRESS_SEPARATOR)
                    .map(s => s.trim()).includes(messageSubaddress);

        // Accept forward if the the message user and sub-address are allowed
        let acceptForwardWasSuccessful = false;
        if (messageUserIsAllowed && messageSubaddressIsAllowed) {
            const acceptCompoundDestination =
                validateCompoundDestination(userDestination);
            warnAboutBadDestinations(messageUser, acceptCompoundDestination, 'AcceptForward', CONFIGURATION);
            // Forward with custom header set to customHeaderPass
            acceptForwardWasSuccessful =
                await forwardToCompoundDestination(
                    message,
                    'AcceptForwarding',
                    acceptCompoundDestination.validPrimary,
                    new Headers({ [customHeader]: customHeaderPass }),
                    theEmailImage,
                    CONFIGURATION
                );
        }

        // If accept forward failed or none was attempted then reject forward
        if (!acceptForwardWasSuccessful) {
            const rejectCompoundDestination =
                validateCompoundDestination(userRejectTreatment);
            let rejectForwardWasSuccessful = false;
            // Reject forward if there are some valid reject forward destinations
            if (rejectCompoundDestination.validPrimary.length > 0) {
                warnAboutBadDestinations(messageUser, rejectCompoundDestination, 'RejectForward', CONFIGURATION);
                rejectForwardWasSuccessful =
                    await forwardToCompoundDestination(
                        message,
                        'RejectForwarding',
                        rejectCompoundDestination.validPrimary,
                        new Headers({ [customHeader]: customHeaderFail }),
                        theEmailImage,
                        CONFIGURATION
                    );
            }

            // If reject forward failed or none was attempted then direct reject
            if (!rejectForwardWasSuccessful) {
                const userRejectReason =
                    !userRejectTreatment.includes('@') && userRejectTreatment
                    || !globalRejectTreatment.includes('@') && globalRejectTreatment
                    || !REJECT_TREATMENT.includes('@') && REJECT_TREATMENT.trim()
                    || DEFAULTS.REJECT_TREATMENT.trim();
                // Prepend the message's local part if the reject reason begin's
                // with a non-alphanumeric
                const fullRejectReason = FIXED.prepend(
                    userRejectReason,
                    [{ test: FIXED.startsWithNonAlphanumericRegExp, prepend: messageLocalPart }]
                );
                message.setReject(fullRejectReason);
                consoleOutput({
                    email: theEmailImage,
                    action: 'DirectRejecting',
                    rejectReason: fullRejectReason,
                }, 'info', CONFIGURATION);
            }
        }
    },
    // Handle a HTTP request by just returning either a not found error
    // response. Not strictly necessary but helps avoid polluting the
    // email worker logs with the more frequent than one would hope
    // "Handler does not export a fetch() function." error message.
    // This appears to be caused by search crawlers attempting to index
    // the domain of the email worker.
    // Having these errors in the logs increases the chance of missing
    // a far more important error relating to email forwarding as generated
    // by the email() function.
    async fetch(request, env, ctx) {
        // Check if the request method is GET
        if (request.method === 'GET') {
            // Return a 404 Not Found response
            return new Response('Not Found', { status: 404 });
        } else {
            // Return a 405 Method Not Allowed response
            return new Response('Method Not Allowed', { status: 405 });
        }
    }
}