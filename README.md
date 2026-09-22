# CoCreate-organizations

A simple organizations component in vanilla javascript. Easily configured using HTML5 attributes and/or JavaScript API. Take it for a spin in our [playground!](https://cocreate.app/docs/organizations)

![minified](https://img.badgesize.io/https://cdn.cocreate.app/organizations/latest/CoCreate-organizations.min.js?style=flat-square&label=minified&color=orange)
![gzip](https://img.badgesize.io/https://cdn.cocreate.app/organizations/latest/CoCreate-organizations.min.js?compression=gzip&style=flat-square&label=gzip&color=yellow)
![brotli](https://img.badgesize.io/https://cdn.cocreate.app/organizations/latest/CoCreate-organizations.min.js?compression=brotli&style=flat-square&label=brotli)
![GitHub latest release](https://img.shields.io/github/v/release/CoCreate-app/CoCreate-organizations?style=flat-square)
![License](https://img.shields.io/github/license/CoCreate-app/CoCreate-organizations?style=flat-square)
![Hiring](https://img.shields.io/static/v1?style=flat-square&label=&message=Hiring&color=blueviolet)

![CoCreate-organizations](https://cdn.cocreate.app/docs/CoCreate-organizations.gif)

## [Docs & Demo](https://cocreate.app/docs/organizations)

For a complete guide and working demo refer to the [doumentation](https://cocreate.app/docs/organizations)

## CDN

```html
<script src="https://cdn.cocreate.app/organizations/latest/CoCreate-organizations.min.js"></script>
```

```html
<script src="https://cdn.cocreate.app/organizations/latest/CoCreate-organizations.min.css"></script>
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

All updates to this library are documented in our [CHANGELOG](https://github.com/CoCreate-app/CoCreate-organizations/blob/master/CHANGELOG.md) and [releases](https://github.com/CoCreate-app/CoCreate-organizations/releases). You may also subscribe to email for releases and breaking changes.

<a name="roadmap"></a>

# Roadmap

If you are interested in the future direction of this project, please take a look at our open [issues](https://github.com/CoCreate-app/CoCreate-organizations/issues) and [pull requests](https://github.com/CoCreate-app/CoCreate-organizations/pulls). We would love to hear your feedback.

<a name="about"></a>

# About

CoCreate-organizations is guided and supported by the CoCreate Developer Experience Team.

Please Email the Developer Experience Team [here](mailto:develop@cocreate.app) in case of any queries.

CoCreate-organizations is maintained and funded by CoCreate. The names and logos for CoCreate are trademarks of CoCreate, LLC.

<a name="contribute"></a>

# How to Contribute

We encourage contribution to our libraries (you might even score some nifty swag), please see our [CONTRIBUTING](https://github.com/CoCreate-app/CoCreate-organizations/blob/master/CONTRIBUTING.md) guide for details.

We want this library to be community-driven, and CoCreate led. We need your help to realize this goal. To help make sure we are building the right things in the right order, we ask that you create [issues](https://github.com/CoCreate-app/CoCreate-organizations/issues) and [pull requests](https://github.com/CoCreate-app/CoCreate-organizations/pulls) or merely upvote or comment on existing issues or pull requests.

We appreciate your continued support, thank you!


<a name="license"></a>
# License

[The MIT License (MIT)](https://github.com/CoCreate-app/CoCreate-organizations/blob/master/LICENSE)


### Authenticated organization creation

Run `signUp` and `signIn` successfully before `createOrganization`. The client
sends the `organizations` form record without submitting a user profile,
password, keys, or switching its current connection. Separate sections of a
single form may supply signup and organization details.

The server requires an authenticated socket and uses its source organization
and user ID to resolve a single `keys` credential (`type: "user"`). The
credential's `array` and `key` identify the profile to copy; the collection name
is not hardcoded. The profile keeps its ID, with password and CRUD metadata
excluded. A new tenant credential preserves existing authentication fields
server-side and receives the new tenant's admin role. Client-supplied user and
key records are ignored. The local `generateDB` bootstrap remains separate.

The submitted organization fields, including host and storage, are preserved;
server-generated IDs replace supplied IDs, and internal `$` metadata and
`bootstrapStorage` are excluded. Regular CRUD calls register the organization
first, then create its tenant organization record, user, and keys. Storage
routing uses the platform organization ID for all creation requests. The first
write targets the platform database; subsequent writes explicitly target the
new organization ID as their database. Ownership handoff is separate. Creation stops on the first
failed operation. These writes are not transactional: a failed provision can
leave a registered organization with incomplete tenant data. The hostname availability lookup is not an atomic
reservation; concurrent creation of the same hostname needs a database-level
uniqueness constraint before public onboarding.

Responses remain in the source session scope and return the new organization's
ID, name, host, and the profile ID/collection. Credentials and storage connection
settings are not returned. Session transfer and navigation to the new host are
separate from creation. Both creation actions use `action.end(response)` only
on success, otherwise `action.abort()`, with shared notification rendering.
