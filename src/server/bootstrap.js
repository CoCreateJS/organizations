/** Validate the shared bootstrap envelope without interpreting provider fields. */
export function requireBootstrapStorage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.name !== 'string' || !value.name.trim() ||
        typeof value.provider !== 'string' || !value.provider.trim()) {
        throw new Error('Database provisioning requires a bootstrapStorage object with non-empty name and provider fields.');
    }
    return value;
}
