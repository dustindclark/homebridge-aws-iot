export const encode = function (valueToEncode: string): string {
    return Buffer.from(valueToEncode).toString('base64url');
}