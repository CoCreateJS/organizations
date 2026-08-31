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

const platformSocket = {
    config: {
        organization_id: process.env.organization_id
    }
};

/**
 * Standard error state structure normalization helper.
 */
function errorHandler(data, error) {
    data.success = false;
    if (server && server.crud) {
        server.crud.errorHandler(data, error);
    }
}

/**
 * Validates, formats, and executes concurrent database creations for a new tenant organization,
 * user account, and baseline authorization key sets.
 */
async function createOrganization(data) {
    try {
        const { organization, user, key } = data;

        if (
            !organization ||
            !organization._id ||
            !organization.host ||
            !organization.host[0] ||
            !organization.host[0].name
        ) {
            errorHandler(
                data,
                "invalid_organization: missing required organization fields"
            );
        }

        if (!user || !user._id || !user.email || !user.password) {
            errorHandler(
                data,
                "invalid_user: missing required user fields"
            );
        }

        if (!key || !Array.isArray(key) || key.length < 4) {
            errorHandler(
                data,
                "invalid_key: An array of 4 keys is required with type key, user and role."
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
        Data.method = "object.update";
        Data.host = organization.host[0].name;
        Data.database = [organization._id];
        Data.organization_id = organization._id;
        Data.upsert = true;

        if (organization && server && server.crud) {
            organization.organization_id = organization._id;
            const response = await server.crud.send({
                ...Data,
                array: "organizations",
                object: organization
            });
            if (response.error) {
                errorHandler(data, response.error);
            }
        }

        if (user && server && server.crud) {
            user.organization_id = organization._id;
            const response = await server.crud.send({
                ...Data,
                array: "users",
                object: user
            });
            if (response.error) {
                errorHandler(data, response.error);
            }
        }

        if (key && server && server.crud) {
            key.forEach(k => {
                k.organization_id = organization._id;
            });
            const response = await server.crud.send({
                ...Data,
                array: "keys",
                object: key
            });
            if (response.error) {
                errorHandler(data, response.error);
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