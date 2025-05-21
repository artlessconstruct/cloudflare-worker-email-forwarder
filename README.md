# A Cloudflare Email Worker forwarding sub-addressed emails to multiple destinations with failover

This is a [Cloudflare Email Worker](https://developers.cloudflare.com/email-routing/email-workers/) providing configurable email forwarding which routes from email addresses using [sub-addressing](https://en.wikipedia.org/wiki/Email_address#Sub-addressing) (a.k.a. [RFC 5233 Sub-address Extension](https://datatracker.ietf.org/doc/html/rfc5233), tagged addresses, plus addresses, etc.) to a set of primary destinations simultaneously, where each such primary destination is a sequence of backup destinations attempted sequentially until one succeeds.

## Overview

Cloudflare provides a free [Email Routing service](https://developers.cloudflare.com/email-routing/) for all domains using Cloudflare as the authoritative name server. However, at the time of writing this service does not provide:
1. Support for sub-addressed Email_address:
	- Several Cloudflare Community posts such as [this](https://community.cloudflare.com/t/support-plus-addressing-in-email-routing/346812) have requested support for sub-addressing in Cloudflare's Email Routing, but at the time of writing Cloudflare have not made any specific announcement as to when it will be supported.
	- While [Cloudflare's Email Routing documentation](https://developers.cloudflare.com/email-routing/postmaster/#signs-such--and--are-treated-as-normal-characters-for-custom-addresses) states that `+` or `.` are treated as normal characters in a custom address testing reveals that only lower case alphanumeric, `_` and `.` characters are allowed in a custom address used in a routing rule.
	- As a work around [Cloudflare recommends a catch-all solution](https://blog.cloudflare.com/migrating-to-cloudflare-email-routing/#gmail-address-conventions), but that only allows routing to a single destination address and exposes that address to potential spam.
2. Support for forwarding emails to multiple destinations:
	- Again, several Cloudflare Community posts such as [this](https://community.cloudflare.com/t/email-routing-to-multiple-destinations/330260) have requested support for forwarding to multiple destinations in Cloudflare's Email Routing, but at the time of writing Cloudflare have not made any specific announcement as to when it will be supported.

This Email Worker provides a reliable solution to these shortcomings in Cloudflare's Email Routing as it can be enabled as a domain's catch-all address action and then configured to restrict the users and sub-addresses for which email is accepted, control where email is forwarded if it is accepted, including to multiple destinations, and how to reject it if it is not.

### Features

- Supports routing on addresses using sub-addressing
- Supports simultaneous routing to multiple primary destinations.
- Supports failover for each primary destination by routing to a sequence of one or more backup destinations which are attempted sequentially until one succeeds.
- Limits users for which email is accepted.
- Limits sub-addresses for which email is accepted (globally or per user).
- Either direct-rejects with a reject reason or reject-forwards to a destination address (globally defined or per user).
- Adds an email header for filtering forwarded emails in destination email client.
- Supports KV namespaces for unlimited[*](#limitations) user-to-destination combinations (with global fallbacks).
- Classifies errors experienced when attempting to forward an email as either:
	- Recoverable: a.k.a. "transient", "temporary" or "soft" errors, which are often resolved after a period of time without any intervention by an administrator.
	- Unrecoverable: a.k.a. "permanent", "persistent" or "hard" errors, which are often caused by a configuration error or a fault in the underlying system or network and which are not likely to be resolved without some intervention by an administrator.
- Handles errors experienced during forwarding as follows:
	- If there are one or more recoverable errors then throws an exception, which returns an error to the sender, which then will usually periodically resend the email until a retry or time limit has been reached.
	- If there are any unrecoverable errors then these are just logged (as errors, if this is enabled) since throwing and returning an error to the sender would result in unnecessary resends as the errors will likely persist until the underlying fault has been rectified.
	- If no primary destination was successfully forwarded to without error then the email is rejected (by reject-forwarding or direct-rejecting as configured).
- Supports advanced configuration via environment variables.

### Limitations

1. **Cloudflare only forwards to verified destination addresses!**

2. Using Email Workers introduces limits that may not otherwise exist with [Cloudflare Email Routing's routing rules](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/).
	- For comparison Cloudflare Email Routing has [limits on the number of routing rules and destination addresses](https://developers.cloudflare.com/email-routing/limits/#rules-and-addresses). These are not tiered, and although a form is offered to request a limit increase, the criteria under which this would be granted is not clear. At the time of writing the standard limits were:
		- Rules: 200
		- Destination addresses: 200
	- A KV namespace used by an Email Worker is subject to [these KV namespace limits)](https://developers.cloudflare.com/kv/platform/limits/), which on the free tier at the time of writing included:
		- Reads: 100,000/day
		- Storage/account: 1 GB
		- Storage/namespace: 1 GB
		- Keys/namespace: unlimited
		- Key size: 512 bytes
		- Value size: 25 MiB
	- A Worker itself has both [general limits](https://developers.cloudflare.com/workers/platform/limits/#account-plan-limits) and [request limits](https://developers.cloudflare.com/workers/platform/limits/#worker-limits), which on the free tier at the time of writing included:
		- Requests: 100,000 requests/day, 1,000 requests/min
		- Memory: 128 MB
		- CPU time: 10 ms
	- Given these limits an Email Worker using a KV namespace to store its routing rules should provide for a significantly greater number of rules, but it may not be suitable if the domain receives a very high volume of email traffic due to the KV namespace read and Worker request limits.

## Usage

### Install

Considerations:
- If you have multiple email domains then these will each require their own Email Worker unless each domain can share the same configuration, as none of the Email Worker configuration is domain specific.

Procedure:
1. Create the Email Workers you require by following [Cloudflare instructions to enable Email Workers](https://developers.cloudflare.com/email-routing/email-workers/enable-email-workers/).
	1. Choose the option to create a `Start with Hello World!` worker, give it a suitable name and then deploy it.
	2. Then choose to `Edit code` and replace the newly created Worker's code to be the content of this repository's `worker.js` file and again deploy it.
2. Optionally, [create one or more KV namespaces](#create-a-kv) if user specific routing is required for any of your Email Workers.

#### Create a KV namespace

Procedure:
1. Follow [Cloudflare's instructions to create a KV Namespace](https://developers.cloudflare.com/kv/get-started/#2-create-a-kv-namespace).
2. Follow [Cloudflare's instructions to bind your KV Namespace to your Email Worker](https://developers.cloudflare.com/kv/get-started/#3-bind-your-worker-to-your-kv-namespace), choosing the `BINDING_NAME` as `MAP`.

### Configure

> [!TIP]
> - Environment variables can be added, edited or removed by following [Cloudflare's instructions to add environment variables via the dashboard](https://developers.cloudflare.com/workers/configuration/environment-variables/#add-environment-variables-via-the-dashboard).
> - KV namespace key-value pairs can be edited by following [Cloudflare's instructions to interact with your KV namespace](https://developers.cloudflare.com/kv/get-started/#4-interact-with-your-kv-namespace).

#### KV namespace loading controls

To avoid unnecessary KV reads you can set these environment variables to `false` to disable the loading and subsequent use of certain `MAP`-bound KV namespace key-value pairs when processing an email forward request:
- `USE_STORED_ADDRESS_CONFIGURATION`: Load `@DESTINATION`, `@REJECT_TREATMENT`, `@SUBADDRESSES` and `@USERS` (defaults to `false`).
- `USE_STORED_USER_CONFIGURATION`: Load `{User}` and `{User}+` where `{User}` is the user part of an email address being routed in a request (defaults to `true`).

#### Routing

> [!CAUTION]
> By default all email is rejected so be sure to [configure](#configure) at least one user and destination to enable email forwarding.

> [!NOTE]
> Whitespace is ignored in user, sub-address and destination address configuration.

##### _Required:_ Allowed users

To allow forwarding of email received for `{User}@{Domain}` or `{User}+{Subaddress}@{Domain}` add the `{User}`:
1. as a key `{User}` in the `MAP`-bound KV namespace, or
2. in the global allowed users configuration (in order of precedence):
	1. as one of comma-separated users in the `@USERS` value in the `MAP`-bound KV namespace, or otherwise
	2. as one of the comma-separated users in the `USERS` environment variable (defaults to the empty string indicating no users).

> [!NOTE]
> Setting the global allowed users configuration to `*` accepts email for all users (subject to `SUBADDRESSES` restrictions).

##### _Optional:_ Allowed sub-addresses

To allow forwarding of email received for `{User}+{Subaddress}@{Domain}` add the `{Subaddress}`:
1. as one of the comma-separated sub-addresses in the `{User}+` value in the `MAP`-bound KV namespace (applied to `{User}` only), or
2. in the global allowed sub-addresses configuration (in order of precedence):
	1. as one of the comma-separated sub-addresses in the `@SUBADDRESSES` value in the `MAP`-bound KV namespace, or
	2. as one of the comma-separated sub-addresses in the `SUBADDRESSES` environment variable (defaults to `*`)

> [!NOTE]
> Setting the global allowed sub-addresses configuration to `*` allows any sub-address (subject to `USERS` restrictions).

> [!NOTE]
> If any of these configurations is set to a value beginning with `+` then a recipient without any sub-address will not be allowed.

##### _Required:_ Destination

Set the destination email address to which accepted emails sent to `{User}+{Subaddress}@{Domain}` will be forwarded in any of the following (in order of precedence):
1. as the `{User}` value in the `MAP`-bound KV namespace or the first semicolon-separated part of this value  (applies to `{User}` only), or
2. in the global destination configuration (in order of precedence):
	1. as the `@DESTINATION` value in the `MAP`-bound KV namespace, or
	2. as the `DESTINATION` environment variable (defaults to the empty string indicating no destination)

> [!NOTE]
> Multi-user destinations: Setting global destination configuration to a domain (e.g. `@{DestinationDomain}` will forward allowed emails to `{User}@{DestinationDomain}`).

> [!NOTE]
> Default user-specific destination: Setting the `{User}` value in the `MAP`-bound KV namespace to the empty string indicates that the destination should be the global configuration destination.

> [!NOTE]
> To route to a set of primary addresses simultaneously, specify each destination in a comma-separated list. For example:
>
>	 any@email1.com, any@email2.com

> [!NOTE]
> To specify a primary address as a sequence of one or more backup addresses, such that each backup address is attempted sequentially in the order specified until one succeeds, specify the sequence of backup addresses as a colon-separated list. For example:
>
>	 primary.or.backup0@email.com:backup1@email.com:backup2@email.com

##### _Optional:_ Reject treatment

An email which is not allowed can be rejected by either:
1. direct-rejecting with the explanatory reason `{RejectReason}` (which cannot contain the `@` character and defaults to `: Invalid recipient`), or
2. reject-forwarding to `{RejectDestination}`

Set the reject treatment for an email sent to `{User}+{Subaddress}@{Domain}` in any of the following (in order of precedence):
1. as the second semicolon-separated part of the `{User}` value in the `MAP`-bound KV namespace (applies only `{User}` only), or
2. in global reject treatment configuration (in order of precedence):
	1. as the `@REJECT_TREATMENT` value in the `MAP`-bound KV namespace, or
	2. as the `REJECT_TREATMENT` environment variable

> [!NOTE]
> Reject reasons which begin with colon `:` will be prepended with the recipient email address's user when inserted into the reject email header.

> [!NOTE]
> Multi-user reject destinations: Setting global reject configuration to a sub-address and domain enables multi-user reject destinations (e.g. a reject treatment of `+{RejectDestinationSubaddress}@{RejectDestinationDomain}` will reject-forward emails to `{User}+{RejectDestinationSubaddress}@{RejectDestinationDomain}`).

#### Advanced configuration

See the `worker.js` export constant `DEFAULTS` for documentation on advanced configuration which can be made by environment variables, including of the address and local part separators, the email address validation regular expression, custom forwarding header name and pass and fail values and the recoverable forwarding error regular expression.

> [!CAUTION]
> The Email Worker has not been tested with any changes to the advanced configuration so proceed with caution and test that any advanced configuration works as expected before deploying it to a production environment.

### Enable

Procedure:
1. Follow [Cloudflare's instructions to configure Email Routing's catch-all address for your domain](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/#catch-all-address):
	1. Choose the [action](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/#email-rule-actions) to be `Send to a Worker`.
	2. Select your newly [installed](#install) and [configured](#configure) Email Worker as the action's Worker.

### Troubleshooting

To view your Email Worker's logs follow [Cloudflare's instructions for viewing logs form the Dashboard](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#view-logs-from-the-dashboard)

To control the level of logging set the `CONSOLE_OUTPUT_LEVEL` environment variable to a value from `0` to `5`, where `0` indicates no logging and higher values indicate more detailed logging with `1` = `error`, `2` = `warn`, `3` = `info`, `4` = `log`, and `5` = `debug`, and which defaults to `2` = `warn`.

### Automated builds

You can automate the building and deployment of your Email Worker using Cloudflare's CI/CD.

Procedure:
1. Connect your Email Worker to a GitHub repository by following [Cloudflare's instructions](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker).
	1. Set the `Git repository` to this repository, or a fork of it if you prefer to maintain oversight of any new builds being deployed.
	2. Set the `Git branch` to the major release branch your Email Worker is using, for example `release/v1`
2. Configure the build by following [Cloudflare's instructions for Worker CI/CD Build Configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/). In particular:
	1. Set the `Build command` as `pnpm run build`.
	2. Set the `Deploy command` as `npx wrangler deploy`.
	3. Set the following `Build variables` which the build script `build.sh` will incorporate into `wrangler.toml` which it generates from the template `wrangler.template.toml`:
		1. `WRANGLER_NAME`: Name of Email Worker
		2. `WRANGLER_KV_MAP_ID`: KV namespace Id if one is being used
		3. `WRANGLER_VARS_{EnvironmentVariable}`: Used to set the environment variable `{EnvironmentVariable}` which is added to the `[Vars]` section of the generated `wrangler.toml`

## Contributions

Contributions are welcome and not just pull requests so you are welcome to:
- [Open an issue](https://github.com/artlessconstruct/cloudflare-worker-email-forwarder/discussions/new/choose)
- [Start a discussion](https://github.com/artlessconstruct/cloudflare-worker-email-forwarder/issues/new)

## Acknowledgements

This Email Worker was inspired by the [Cloudflare Worker email-subaddressing](https://github.com/jeremy-harnois/cloudflare-worker-email-subaddressing).

## License

All works herein are licensed under [MIT](LICENSE).
