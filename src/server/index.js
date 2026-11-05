/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 ********************************************************************************/

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://CoCreateJS.com/licenses/> or contact us at sales@CoCreateJS.com.

import { ObjectId, uuid } from '@cocreate/utils';
import { resolveOrganizationsConfig } from './config.js';
import { requireBootstrapStorage } from './bootstrap.js';
import { createRepositoryCredential, githubKnownHosts } from './repository-credential.js';
import { isDeepStrictEqual } from 'node:util';
import { createClusterManagementAccess } from './cluster-management.js';

let server;

/**
 * Standard error state structure normalization helper.
 * @private
 * @environment server
 */
function errorHandler(data, error) {
    data.success = false;
    data.message = typeof error === "string"
        ? error
        : error?.message || "Organization request failed";
    data.error = data.message;
}

function createOrganizationHosts(details, hostname) {
    const submitted = Array.isArray(details?.host) && details.host[0]
        ? { ...details.host[0] }
        : {};
    for (const field of ["database", "storage"]) {
        const value = details?.[`host[0].${field}`] ?? details?.[`host.0.${field}`];
        if (value !== undefined) submitted[field] = value;
    }
    submitted.name = hostname;
    return [
        submitted,
        { database: "dev", name: `dev.${hostname}`, storage: "" },
        { database: "test", name: `test.${hostname}`, storage: "" }
    ];
}

async function runWorkflow(name, organization_id, host, input) {
    if (typeof server?.workflow?.run !== 'function') {
        throw new Error('Organization workflows are unavailable');
    }

    const result = await server.workflow.run({
        method: `workflow.${name}`,
        organization_id,
        host,
        [name]: [input]
    });
    const errors = Array.isArray(result?.error)
        ? result.error
        : result?.error ? [result.error] : [];
    if (errors.length) {
        throw new Error(errors.map(error => error?.message || String(error)).join('; '));
    }

    return result?.[name]?.[0] || {};
}

async function requireEnabledPlatformWorkflow(name, host) {
    const response = await checkedSend({
        method: 'object.read',
        organization_id: server.organization_id,
        host,
        array: 'workflows',
        filter: { query: { name, enabled: true }, key: { _id: 1, name: 1, description: 1, enabled: 1, actions: 1 }, limit: 1 }
    });
    if (!response.object?.length) {
        throw new Error(`The ${name} workflow is unavailable or disabled`);
    }
    return response.object[0];
}

/** Create an organization and its authenticated user and keys.  * @private
 * @environment server
 */
async function createOrganization(data) {
    const socket = data.socket;
    const response = {
        method: "createOrganization",
        uuid: data.uuid,
        socket,
        host: socket?.host,
        organization_id: socket?.organization_id,
        broadcastClient: false,
        success: false
    };
    let organizationId;
    let organizationRegistered = false;
    let databaseAttached = false;
    let tenantInitialized = false;
    let clusterInitialized = false;
    let managementInitialized = false;
    let clusterId;
    let repositoryInitialized = false;
    try {
        if (!socket?.user_id || !socket.organization_id ||
            (socket.expires && Date.now() >= Number(socket.expires))) {
            throw new Error("Sign in before creating an organization");
        }
        const details = data.organization;
        const name = (typeof details?.name === "string" ? details.name.trim() : "") || "Untitled";
        const hostName = details?.host?.[0]?.name ?? details?.["host[0].name"] ?? details?.["host.0.name"];
        const hostname = typeof hostName === "string" ? hostName.trim().toLowerCase() : "";
        if (hostname.length > 253 || !hostname.includes(".") ||
            !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
            throw new Error("A valid host is required");
        }
        const hosts = createOrganizationHosts(details, hostname);

        // Source scope and identity come from the authenticated socket, never the payload.
        const source = { organization_id: socket.organization_id, host: socket.host };
        const credentials = await checkedSend({
            ...source, method: "object.read", array: "keys", object: [],
            filter: { limit: 2, query: { type: "user", key: socket.user_id } }
        });
        if (credentials.object?.length !== 1) {
            throw new Error("Unable to resolve the signed-in user's credential");
        }
        const credential = credentials.object[0];
        if (typeof credential.array !== "string" || !credential.array ||
            String(credential.key) !== String(socket.user_id)) {
            throw new Error("The user credential is missing its profile reference");
        }
        const profiles = await checkedSend({
            ...source, method: "object.read", array: credential.array,
            object: [{ _id: credential.key }], filter: { limit: 1 }
        });
        const profile = profiles.object?.[0];
        if (!profile || String(profile._id) !== String(socket.user_id)) {
            throw new Error("Unable to find the signed-in user's profile");
        }

        const existing = await checkedSend({
            method: "object.read", database: server.organization_id,
            organization_id: server.organization_id, array: "organizations", object: [],
            filter: {
                limit: 1,
                query: { "host.name": { $in: hosts.map(host => host.name) } }
            }
        });
        if (existing.object?.length) throw new Error("That host is already in use");

        const organizationsConfig = server.organizations.config || {};
        const databaseSettings = organizationsConfig.databaseProvisioning || {};
        const databaseWorkflow = organizationsConfig.databaseWorkflow || 'create-organization-database';
        const organizationWorkflow = organizationsConfig.organizationWorkflow || 'create-organization';
        const clusterWorkflow = organizationsConfig.clusterWorkflow || 'create-organization-cluster';
        const clusterSettings = structuredClone(organizationsConfig.clusterProvisioning || {});
        if (!Number.isInteger(clusterSettings.scaleIn?.minClusterSize) || clusterSettings.scaleIn.minClusterSize < 0) {
            throw new Error('Organization cluster requires a nonnegative integer minimum cluster size');
        }
        if (!['cloud', 'region', 'vmType'].every(key => typeof clusterSettings.initialDeployment?.[key] === 'string' && clusterSettings.initialDeployment[key].trim())) {
            throw new Error('Organization cluster requires initialDeployment cloud, region and VM type');
        }
        const repositoryWorkflow = organizationsConfig.repositoryWorkflow || 'create-organization-repository';
        const repositorySettings = organizationsConfig.repositoryProvisioning || {};
        await requireEnabledPlatformWorkflow(databaseWorkflow, socket.host);
        const organizationDefinition = await requireEnabledPlatformWorkflow(organizationWorkflow, socket.host);
        const clusterDefinition = await requireEnabledPlatformWorkflow(clusterWorkflow, socket.host);
        await requireEnabledPlatformWorkflow(repositoryWorkflow, socket.host);

        organizationId = ObjectId().toString();
        const provisioning = {
            status: "provisioning",
            requested_at: new Date().toISOString()
        };
        const organization = {
            ...details,
            name,
            _id: organizationId,
            organization_id: organizationId,
            host: hosts,
            provisioning
        };
        delete organization.bootstrapStorage;
        delete organization.storage;
        delete organization.git;
        delete organization.cluster_id;
        for (const key of Object.keys(organization)) {
            if (/^host(?:\[0\]|\.0)\./.test(key)) delete organization[key];
        }
        for (const key of Object.keys(organization)) if (key.startsWith("$")) delete organization[key];
        const user = { ...profile, organization_id: organizationId };
        delete user.password;
        for (const key of Object.keys(user)) if (key.startsWith("$")) delete user[key];

        const roleId = ObjectId().toString();
        const userKey = {
            _id: ObjectId().toString(), type: "user", key: user._id,
            name: user.name, array: credential.array, roles: [roleId]
        };
        for (const field of ["email", "username", "password"]) {
            if (credential[field] !== undefined) userKey[field] = credential[field];
        }
        const uploadApiKey = uuid();
        const keys = [
            {
                _id: ObjectId().toString(), type: "key", key: uuid(), default: true,
                name: "Default", hosts: ["*"],
                actions: {
                    signIn: true, signUp: true, checkSession: true,
                    forgotPassword: true, resetPassword: true, acceptInvite: true,
                    updateUserStatus: true, isUnique: true
                }
            },
            {
                _id: ObjectId().toString(), type: "key", key: uploadApiKey,
                name: "Deployment", admin: true
            },
            { _id: roleId, type: "role", name: "admin", admin: true },
            userKey
        ].map(key => ({ ...key, organization_id: organizationId }));
        // Register the platform organization first. Tenant storage is attached
        // only after the workflow has provisioned and persisted its bootstrap object.
        await checkedSend({
            method: "object.create", database: server.organization_id,
            organization_id: server.organization_id, array: "organizations", object: organization
        });
        organizationRegistered = true;

        const database = await runWorkflow(databaseWorkflow, server.organization_id, socket.host, {
            ...databaseSettings,
            organizationId
        });
        const bootstrapStorage = requireBootstrapStorage(database.bootstrapStorage);
        const storedOrganization = await checkedSend({
            method: 'object.read', database: server.organization_id,
            organization_id: server.organization_id, array: 'organizations',
            object: [{ _id: organizationId }],
            filter: { key: { _id: 1, bootstrapStorage: 1 }, limit: 1 }
        });
        if (!isDeepStrictEqual(storedOrganization.object?.[0]?.bootstrapStorage, bootstrapStorage)) {
            throw new Error('Database provisioning did not persist the returned bootstrapStorage on the platform organization.');
        }
        databaseAttached = true;

        const tenantHosts = hosts.map((host, index) => ({
            ...host,
            database: host.database || (index === 0 ? organizationId : host.database),
            storage: bootstrapStorage.name
        }));
        const tenantOrganization = {
            ...organization,
            bootstrapStorage,
            host: tenantHosts,
            provisioning: {
                ...provisioning,
                status: 'initializing-cluster',
                database: { status: 'ready' },
                tenant: { status: 'ready' },
                cluster: { status: 'pending' }, repository: { status: 'pending' }
            }
        };
        await checkedSend({
            method: 'object.update',
            organization_id: server.organization_id,
            host: socket.host,
            array: 'organizations',
            object: {
                _id: organizationId,
                host: tenantHosts,
                provisioning: {
                    ...provisioning,
                    status: 'initializing-tenant',
                    database: { status: 'ready' }
                }
            }
        });
        await checkedSend({
            method: 'object.update',
            organization_id: organizationId,
            host: hostname,
            array: 'workflows',
            upsert: true,
            object: {
                ...organizationDefinition,
                organization_id: organizationId
            }
        });

        const tenantInitialization = await runWorkflow(organizationWorkflow, organizationId, hostname, {
            organization: tenantOrganization,
            user,
            userArray: credential.array,
            keys
        });
        if (tenantInitialization.initialized !== true) {
            throw new Error('Tenant organization initialization did not complete');
        }
        tenantInitialized = true;

        // Create one identity and one definition; each invocation persists that same cluster.
        clusterId = ObjectId().toString();
        const cluster = {
            ...clusterSettings, _id: clusterId, name: organizationId,
            type: 'organization', host: hostname,
            repositories: structuredClone(clusterSettings.repositories || []),
            manager: {
                organization_id: server.organization_id,
                host: server.host || socket.host,
                for: organizationId
            }
        };
        delete cluster.organization_id;
        for (const key of Object.keys(cluster)) if (key.startsWith('$')) delete cluster[key];
        const clusterInput = { organizationId, cluster };
        const platformCluster = await runWorkflow(clusterWorkflow, server.organization_id, socket.host, structuredClone(clusterInput));
        if (platformCluster.initialized !== true || platformCluster.cluster?._id !== clusterId || !isDeepStrictEqual(platformCluster.cluster?.manager, cluster.manager)) {
            throw new Error('Platform organization cluster initialization did not complete');
        }
        await checkedSend({
            method: 'object.update', organization_id: organizationId, host: hostname,
            array: 'workflows', upsert: true,
            object: { ...clusterDefinition, organization_id: organizationId }
        });
        const tenantDefinition = structuredClone(platformCluster.cluster);
        delete tenantDefinition.organization_id;
        for (const key of Object.keys(tenantDefinition)) if (key.startsWith('$')) delete tenantDefinition[key];
        const tenantCluster = await runWorkflow(clusterWorkflow, organizationId, hostname, { organizationId, cluster: tenantDefinition });
        if (tenantCluster.initialized !== true || tenantCluster.cluster?._id !== clusterId || !isDeepStrictEqual(tenantCluster.cluster?.manager, cluster.manager)) {
            throw new Error('Tenant organization cluster initialization did not complete');
        }
        clusterInitialized = true;

        await createClusterManagementAccess(server, {
            organizationId, clusterId, parentHost: server.host || socket.host
        });
        managementInitialized = true;

        // Keep a pending credential in the tenant DB before registering its public key.
        const repositoryCredential = await createRepositoryCredential(ObjectId().toString());
        await checkedSend({
            method: 'object.update', upsert: true, organization_id: organizationId, host: hostname,
            array: 'apis', object: repositoryCredential
        });
        const repository = await runWorkflow(repositoryWorkflow, server.organization_id, socket.host, {
            ...repositorySettings,
            organizationId,
            credentialId: repositoryCredential._id,
            publicKey: repositoryCredential.publicKey
        });
        if (repository.initialized !== true || !repository.git?.clone_url) {
            throw new Error('Organization repository initialization did not complete');
        }
        if (repository.git.api !== repositoryCredential._id || !Number.isSafeInteger(repository.git.deploy_key_id) || repository.git.deploy_key_id <= 0) {
            throw new Error('Repository deploy key initialization did not complete');
        }
        const knownHosts = githubKnownHosts(repository.hostKeys);
        const activatedCredential = await checkedSend({
            method: 'object.update', organization_id: organizationId, host: hostname, array: 'apis',
            object: {
                _id: repositoryCredential._id, enabled: true, status: 'ready',
                repository_url: repository.git.clone_url, owner: repository.git.owner,
                repository: repository.git.repository, deploy_key_id: repository.git.deploy_key_id,
                knownHosts
            }
        });
        if (!activatedCredential.object?.length) throw new Error('Repository credential was not activated');
        const repositories = [
            ...(Array.isArray(clusterSettings.repositories) ? clusterSettings.repositories : []),
            {
                url: repository.git.clone_url, api: repositoryCredential._id,
                branch: repository.git.checkout_branch || 'main', remote: 'origin',
                localFsRoot: '../', directory: repository.git.repository,
                onStartup: 'clone', onShutdown: 'commit-and-push',
                startupTimeoutMs: 60000, shutdownTimeoutMs: 10000,
                initialUpload: { enabled: true, completed: false }
            }
        ];
        cluster.repositories = structuredClone(repositories);
        for (const [scope, host] of [[server.organization_id, socket.host], [organizationId, hostname]]) {
            const stored = await checkedSend({
                method: 'object.update', array: 'clusters', organization_id: scope, host,
                object: { _id: clusterId, repositories: structuredClone(repositories) }
            });
            if (!stored.object?.length) throw new Error('Cluster repository registration did not complete');
        }
        repositoryInitialized = true;
        await checkedSend({
            method: 'object.update',
            organization_id: organizationId,
            host: hostname,
            array: 'organizations',
            object: {
                _id: organizationId,
                git: repository.git,
                provisioning: {
                    ...provisioning, status: 'ready',
                    database: { status: 'ready' }, tenant: { status: 'ready' },
                    cluster: { status: 'ready' }, management: { status: 'ready' }, repository: { status: 'ready' }
                }
            }
        });

        await server.manager.createServer(cluster);

        const completedAt = new Date().toISOString();
        await checkedSend({
            method: 'object.update',
            organization_id: server.organization_id,
            host: socket.host,
            array: 'organizations',
            object: {
                _id: organizationId,
                provisioning: {
                    ...provisioning,
                    status: 'ready',
                    database: { status: 'ready' },
                    tenant: { status: 'ready' },
                    cluster: { status: 'ready' }, management: { status: 'ready' }, repository: { status: 'ready' },
                    completed_at: completedAt
                }
            }
        });

        response.success = true;
        response.message = "Organization, database, cluster, repository, and server created";
        response.redirect = `https://${hostname}/auth/`;
        response.organization = {
            _id: organizationId,
            name,
            cluster_id: clusterId,
            host: tenantHosts,
            provisioning: { ...provisioning, status: 'ready', completed_at: completedAt }
        };
        response.user_id = user._id;
        response.user_array = credential.array;
        response.provisioning = response.organization.provisioning;
    } catch (error) {
        if (organizationRegistered && organizationId) {
            try {
                await checkedSend({
                    method: 'object.update',
                    organization_id: server.organization_id,
                    host: socket.host,
                    array: 'organizations',
                    object: {
                        _id: organizationId,
                        provisioning: {
                            status: 'failed',
                            failed_at: new Date().toISOString(),
                            error: String(error.message || error).slice(0, 500),
                            database: { status: databaseAttached ? 'ready' : 'failed' },
                            tenant: { status: tenantInitialized ? 'ready' : 'failed' },
                            cluster: { status: clusterInitialized ? 'ready' : 'failed' },
                            management: { status: managementInitialized ? 'ready' : 'failed' },
                            repository: { status: repositoryInitialized ? 'ready' : 'failed' }
                        }
                    }
                });
            } catch (statusError) {
                console.error('Unable to record organization provisioning failure:', statusError.message);
            }
        }
        response.message = error.message || "Unable to create the organization";
        response.error = response.message;
    }
    return server.wsManager.send(response);
}

async function checkedSend(request) {
    const result = await server.crud.send(request);
    const errors = Array.isArray(result?.error) ? result.error.length : result?.error;
    if (!result || errors || result.success === false) {
        throw new Error(`Unable to ${request.method === "object.read" ? "read" : "create"} ${request.array}`);
    }
    return result;
}

/**
 * Orchestrates multi-tenant database clone mappings and environment setup across specific domain hosts.
 * @private
 * @environment server
 */
async function createEnvironments(data) {
    try {
        let { organization, hostname } = data;

        if (!organization) {
            errorHandler(
                data,
                "Missing required field: 'organization'. Please provide the organization object to create an organization."
            );
        }
        if (!hostname) {
            errorHandler(
                data,
                "Missing required field: 'hostname'. Please provide the hostname to create an organization."
            );
        }

        // If there are validation errors, include them in the response and send immediately
        if (data.success === false) {
            if (server && server.wsManager) {
                return server.wsManager.send(data);
            }
            return;
        }

        const Data = {};
        Data.method = "object.read";
        Data.host = hostname;
        Data.organization_id = organization;
        Data.filter = { limit: 0 };

        if (server && server.crud) {
            let organizations = await server.crud.send({
                ...Data,
                array: "organizations",
                object: []
            });

            if (organizations.error) {
                errorHandler(data, organizations.error);
            }

            let users = await server.crud.send({
                ...Data,
                array: "users",
                object: []
            });

            if (users.error) {
                errorHandler(data, users.error);
            }

            let keys = await server.crud.send({
                ...Data,
                array: "keys",
                object: []
            });

            if (keys.error) {
                errorHandler(data, keys.error);
            }

            for (let host of hostname) {
                organizations.method = "object.create";
                organizations.host = host;
                organizations = await server.crud.send(organizations);

                users.method = "object.create";
                users.host = host;
                users = await server.crud.send(users);

                keys.method = "object.create";
                keys.host = host;
                keys = await server.crud.send(keys);
            }
        }

        if (data.success !== false) {
            data.success = true;
        }

        if (server && server.wsManager) {
            server.wsManager.send(data);
        }
    } catch (error) {
        if (data.socket) {
            errorHandler(data, error);
            if (server && server.wsManager) {
                server.wsManager.send(data);
            }
        }
    }
}

const Organizations = {
    create: createOrganization,
    createEnvironments,
    config: null
};

/** Attach organization services and socket handlers to an initialized server.  * @public
 * @environment server
 */
export async function init(Server, options = {}) {
    if (!Server?.crud || !Server?.wsManager) {
        throw new Error("An initialized CoCreate server is required");
    }
    server = Server;
    const organizationsConfig = await resolveOrganizationsConfig(server, options);
    Organizations.config = organizationsConfig;
    server.organizations = Organizations;
    server.wsManager.on("createOrganization", (data) => server.organizations.create(data));
    server.wsManager.on("createEnvironments", (data) => server.organizations.createEnvironments(data));
    return Organizations;
}

/**
 * A simple organizations component in vanilla javascript. Easily configured using HTML5 attributes and/or JavaScript API.
 *
 * @module organizations
 * @environment server
 */
