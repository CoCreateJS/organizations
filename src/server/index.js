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

let server;

async function createOrganization(data) {
    const organization = {
        method: "object.create",
        host: data.host,
        array: "organizations",
        object: {
            ...data.organization,
            owner: data.user_id
        }
    };

    try {
        await server.crud.send(organization);

        if (organization.error) {
            data.error = organization.error;
        }

        if (!(data.organization = organization.object?.[0])) {
            data.error = "Failed to create organization";
        }

    } catch (error) {
        data.error = error.message;
    }

    return server.send(data);
}

const Organizations = {
    create: createOrganization
};

/** Attach organization services and socket handlers to an initialized server.  * @public
 * @environment server
 */
export function init(Server) {
    if (!Server?.crud || !Server?.on) {
        throw new Error("An initialized CoCreate server is required");
    }
    server = Server;
    server.organizations = Organizations;
    server.on("createOrganization", (data) => server.organizations.create(data));
    return Organizations;
}

/**
 * A simple organizations component in vanilla javascript. Easily configured using HTML5 attributes and/or JavaScript API.
 *
 * @module organizations
 * @environment server
 */
