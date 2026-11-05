import { ObjectId, uuid } from '@cocreate/utils';

const permissionReferenceId = '6b0700000000000000000021';

/** Issue management access after the tenant database and managed cluster exist. */
export async function createClusterManagementAccess(server, { organizationId, clusterId, parentHost }) {
    const send = async (request, organization_id = server.organization_id, host = parentHost) => {
        let result;
        try {
            result = await server.crud.send({ ...request, organization_id, host });
        } catch {
            throw new Error(`Cluster management ${request.array} ${request.method} failed.`);
        }
        const errors = Array.isArray(result?.error) ? result.error.length : result?.error;
        if (!result || result.success === false || errors || !result.object?.length) {
            throw new Error(`Cluster management ${request.array} ${request.method} failed.`);
        }
        return result.object[0];
    };
    const permission = await send({
        method: 'object.read', array: 'keys', filter: { query: { _id: permissionReferenceId }, limit: 1 }
    });
    if (permission._id !== permissionReferenceId || !permission.methods) {
        throw new Error('Cluster management permission reference is unavailable.');
    }
    const keyId = ObjectId().toString();
    await send({
        method: 'object.create', array: 'keys', object: {
            _id: keyId, name: `Managed cluster ${clusterId}`, type: 'key', status: 'active',
            key: uuid(), admin: false, default: false,
            methods: structuredClone(permission.methods),
            cluster_id: clusterId, tenant_organization_id: organizationId
        }
    });
    return { key_id: keyId };
}
