# CoCreate-organizations

A simple organizations component in vanilla javascript. Easily configured using HTML5 attributes and/or JavaScript API. Take it for a spin in our [playground!](https://CoCreateJS.com/docs/organizations)

![minified](https://img.badgesize.io/https://cdn.CoCreateJS.com/organizations/latest/CoCreate-organizations.min.js?style=flat-square&label=minified&color=orange)
![gzip](https://img.badgesize.io/https://cdn.CoCreateJS.com/organizations/latest/CoCreate-organizations.min.js?compression=gzip&style=flat-square&label=gzip&color=yellow)
![brotli](https://img.badgesize.io/https://cdn.CoCreateJS.com/organizations/latest/CoCreate-organizations.min.js?compression=brotli&style=flat-square&label=brotli)
![GitHub latest release](https://img.shields.io/github/v/release/CoCreateJS/organizations?style=flat-square)
![License](https://img.shields.io/github/license/CoCreateJS/organizations?style=flat-square)
![Hiring](https://img.shields.io/static/v1?style=flat-square&label=&message=Hiring&color=blueviolet)

![CoCreate-organizations](https://cdn.CoCreateJS.com/docs/CoCreate-organizations.gif)

## [Docs & Demo](https://CoCreateJS.com/docs/organizations)

For a complete guide and working demo refer to the [doumentation](https://CoCreateJS.com/docs/organizations)

## CDN

```html
<script src="https://cdn.CoCreateJS.com/organizations/latest/CoCreate-organizations.min.js"></script>
```

```html
<script src="https://cdn.CoCreateJS.com/organizations/latest/CoCreate-organizations.min.css"></script>
```

## NPM

```shell
$ npm i @cocreate/organizations
```

## yarn

```shell
$ yarn install @cocreate/organizations
```

# Table of Contents

- [Table of Contents](#table-of-contents)
- [Announcements](#announcements)
- [Roadmap](#roadmap)
- [How to Contribute](#how-to-contribute)
- [About](#about)
- [License](#license)

<a name="announcements"></a>

# Announcements

All updates to this library are documented in our [CHANGELOG](https://github.com/CoCreateJS/organizations/blob/master/CHANGELOG.md) and [releases](https://github.com/CoCreateJS/organizations/releases). You may also subscribe to email for releases and breaking changes.

<a name="roadmap"></a>

# Roadmap

If you are interested in the future direction of this project, please take a look at our open [issues](https://github.com/CoCreateJS/organizations/issues) and [pull requests](https://github.com/CoCreateJS/organizations/pulls). We would love to hear your feedback.

<a name="about"></a>

# About

CoCreate-organizations is guided and supported by the CoCreate Developer Experience Team.

Please Email the Developer Experience Team [here](mailto:develop@CoCreateJS.com) in case of any queries.

CoCreate-organizations is maintained and funded by CoCreate. The names and logos for CoCreate are trademarks of CoCreate, LLC.

<a name="contribute"></a>

# How to Contribute

We encourage contribution to our libraries (you might even score some nifty swag), please see our [CONTRIBUTING](https://github.com/CoCreateJS/organizations/blob/master/CONTRIBUTING.md) guide for details.

We want this library to be community-driven, and CoCreate led. We need your help to realize this goal. To help make sure we are building the right things in the right order, we ask that you create [issues](https://github.com/CoCreateJS/organizations/issues) and [pull requests](https://github.com/CoCreateJS/organizations/pulls) or merely upvote or comment on existing issues or pull requests.

We appreciate your continued support, thank you!


<a name="license"></a>
# License

[The MIT License (MIT)](https://github.com/CoCreateJS/organizations/blob/master/LICENSE)


### Authenticated signup

The signup form runs `signUp`, `signIn`, then `createOrganization`. The server
resolves the signed-in profile and credential from the authenticated socket;
client-supplied user, key, bootstrap, and repository metadata do not determine
the new tenant's identity or provisioning credentials.

`server.organizations.create(data)` coordinates these workflows in order:

1. Register a platform organization with a server-generated ID.
2. Run `create-organization-database` in platform context. The workflow creates
   provider storage, persists its `bootstrapStorage` on that platform record,
   and returns the same object. The handler verifies that persistence.
3. Install the platform-defined `create-organization` workflow into the tenant
   database, then execute it in tenant context to write the organization,
   authenticated user profile, credential, and generated keys.
4. Run `create-organization-repository` in platform context. It creates a private
   repository from the template's `main`, commits the initial upload config, and
   creates `dev` and `test` from that same commit. Repository references are
   retained on the platform and tenant organization records.
5. Mark signup ready and return a safe organization summary. Bootstrap and
   deployment credentials are never returned to the client.

The workflow source records live in CoCreate App's
`src/apps/workflows/config/{data,organization,repository}.js`. Stable record IDs
allow repeatable uploads without duplicate definitions. Workflow names are
configurable through `organizations.databaseWorkflow`, `organizationWorkflow`,
and `repositoryWorkflow`. All three enabled platform definitions are checked
before a new organization record is created.

The bootstrap object requires non-empty `name` and `provider` strings; remaining
fields pass through unchanged. The current Atlas database recipe additionally
requires `cloudProvider`, `regionName`, and `cidrBlock` in
`organizations.databaseProvisioning`, with configured provider credentials and
endpoints. That workflow remains disabled until its provider setup is complete.

The repository recipe uses `organizations.repositoryProvisioning` for `api`,
`templateOwner`, and `templateRepository`. The configured managed GitHub API
must have an `owner`, credentials, and the template/file/branch/deploy-key endpoints.
Repository names remain the stable organization ID. The platform workflow's
`initialConfig` AST is the authoritative initial file definition: it includes
upload directory rules, the tenant organization ID, an empty API-key placeholder,
and `main`/`dev`/`test` host mappings. Subsequent uploads resolve the API key
outside Git. The config is generated once during signup, not on node restart.

The sequence is not transactional. Failure retains the platform organization
with `provisioning.status: "failed"` and database/tenant/repository stage status.
A partial GitHub failure can leave a repository or branch for investigation;
automated recovery, rollback, and cleanup are not implemented. A duplicate
repository creation is an error rather than permission to overwrite it.
Hostname availability is checked before creation; concurrent signups still
require database-enforced uniqueness.

This path prepares the repository through APIs; it does not clone a local
checkout or run `coc upload`. Initial application publication remains a separate
next stage. Cluster UI creation only selects existing storage and creates
cluster/server resources; it does not repeat signup. Cluster master checkout and application publishing
remain separate from signup's database and repository creation.

Initialize after the server is ready:

```js
const Organizations = await import("@cocreate/organizations");
await Organizations.init(server);
```

The old `server.organizations.provision` Git/mirror creation path is removed.
Signup is the primary managed organization/database/repository creation route.
The real-workflow signup integration tests are in CoCreate App's
`test/bootstrap-workflow.test.js`; they replace the obsolete native Git
provisioning test fixtures.

### Repository access during signup

After provisioning the tenant database and initial organization/user/key data, the server generates a repository-specific RSA SSH key pair. It stores a disabled pending credential in the tenant's `apis` before calling `create-organization-repository`; only the public key and API-record ID enter that workflow. The workflow creates/configures the repository, reads GitHub SSH host verification keys over HTTPS, and registers a write-enabled deploy key through `create-repository-deploy-key`. Repository metadata includes its SSH clone URL, HTTPS clone URL, credential API ID, and deploy-key ID.

The server then activates the tenant API record with the returned references and host keys before reporting signup ready. No private key is copied into the platform organization, workflow payload, GitHub request, repository config or signup response. Failed registration/persistence leaves signup failed and its credential pending; retries/cleanup are not automatic. GitHub integration credentials require repository Administration write permission to register deploy keys. Deploy keys have no built-in expiration; explicit rotation is deferred. GitHub may still revoke/delete keys, including when the PAT used to create a deploy key is deleted.

Node masters retrieve this credential from their own organization's API record at startup and before shutdown push. Rotation and initial application upload remain separate work.
