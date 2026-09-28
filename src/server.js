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
// For details, visit <https://cocreate.app/licenses/> or contact us at sales@cocreate.app.

import server from '@cocreate/server';
import { ObjectId, uuid } from '@cocreate/utils';

/**
 * Standard error state structure normalization helper.
 */
function errorHandler(data, error) {
    data.success = false;
    data.message = typeof error === "string"
        ? error
        : error?.message || "Organization request failed";
    data.error = data.message;
}

/** Create an organization and its authenticated user and keys. */
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
            filter: { limit: 1, query: { "host.name": hostname } }
        });
        if (existing.object?.length) throw new Error("That host is already in use");

        const organizationId = ObjectId().toString();
        const organization = {
            ...details, name, _id: organizationId, organization_id: organizationId
        };
        delete organization.bootstrapStorage;
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
            { _id: roleId, type: "role", name: "admin", admin: true },
            userKey
        ].map(key => ({ ...key, organization_id: organizationId }));
        const destination = {
            method: "object.create", database: organizationId, organization_id: server.organization_id
        };
        // Register the organization, then create its database using platform storage.
        await checkedSend({
            method: "object.create", database: server.organization_id,
            organization_id: server.organization_id, array: "organizations", object: organization
        });
        for (const [array, object] of [["organizations", organization], [credential.array, user], ["keys", keys]]) {
            await checkedSend({ ...destination, array, object });
        }
        response.success = true;
        response.message = "Organization created";
        response.organization = { _id: organizationId, name, host: organization.host ?? [{ name: hostName }] };
        response.user_id = user._id;
        response.user_array = credential.array;
    } catch (error) {
        response.message = error.message || "Unable to create the organization";
    }
    return server.wsManager.send(response);
}

async function checkedSend(request) {
    const result = await server.crud.send(request);
    if (!result || result.error || result.success === false) {
        throw new Error(`Unable to ${request.method === "object.read" ? "read" : "create"} ${request.array}`);
    }
    return result;
}

/**
 * Orchestrates multi-tenant database clone mappings and environment setup across specific domain hosts.
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

/**
 * Auto-initialization loop.
 * Silently polls to verify that the unified server orchestrator is fully loaded,
 * and that both the database (crud) and socket manager (wsManager) have completed
 * their initial handshakes, then attaches active organization creation listeners.
 */
function init() {
    if (server && server.isInitialized && server.crud && server.wsManager) {
        server.wsManager.on("createOrganization", (data) => createOrganization(data));
        server.wsManager.on("createEnvironments", (data) => createEnvironments(data));
    } else {
        // If the shared WebSocket manager has not yet populated, check again in 500ms
        setTimeout(init, 500);
    }
}

// Auto-execute initialization instantly upon module load
init();

export default init;