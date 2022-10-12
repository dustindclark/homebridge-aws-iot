import sha256 from 'crypto-js/sha256';
import hmacSHA256 from 'crypto-js/hmac-sha256';


export const prepareWebSocketUrl = (options) => {
    const now = getDateTimeString();
    const today = getDateString(now);
    const path = '/mqtt';
    const awsServiceName = 'iotdevicegateway';
    const queryParams = 'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=' + options.username + '%2F' + today + '%2F' + options.region + '%2F' + awsServiceName + '%2Faws4_request' +
        '&X-Amz-Date=' + now +
        '&X-Amz-SignedHeaders=host';
    let hostName = options.host;

    return signUrl('GET', 'wss://', hostName, path, queryParams,
        options.username, options.password, options.region, awsServiceName, '', today, now, options.debug);
}

function signUrl(method, scheme, hostname, path, queryParams, accessId, secretKey, region, serviceName, payload, today, now, debug) {

    const signedHeaders = 'host';

    var canonicalHeaders = 'host:' + hostname.toLowerCase() + '\n';

    var canonicalRequest = method + '\n' + // method
        path + '\n' + // path
        queryParams + '\n' + // query params
        canonicalHeaders + // headers
        '\n' + // required
        signedHeaders + '\n' + // signed header list
        sha256(payload, {
            asBytes: true
        }); // hash of payload (empty string)

    if (debug === true) {
        console.log('canonical request: ' + canonicalRequest + '\n');
    }

    var hashedCanonicalRequest = sha256(canonicalRequest, {
        asBytes: true
    });

    if (debug === true) {
        console.log('hashed canonical request: ' + hashedCanonicalRequest + '\n');
    }

    var stringToSign = 'AWS4-HMAC-SHA256\n' +
        now + '\n' +
        today + '/' + region + '/' + serviceName + '/aws4_request\n' +
        hashedCanonicalRequest;

    if (debug === true) {
        console.log('string to sign: ' + stringToSign + '\n');
    }

    var signingKey = getSignatureKey(secretKey, today, region, serviceName);

    if (debug === true) {
        console.log('signing key: ' + signingKey + '\n');
    }

    var signature = hmacSHA256(stringToSign, signingKey, {
        asBytes: true
    });

    if (debug === true) {
        console.log('signature: ' + signature + '\n');
    }

    var finalParams = queryParams + '&X-Amz-Signature=' + signature;

    var url = scheme + hostname + path + '?' + finalParams;

    if (debug === true) {
        console.log('url: ' + url + '\n');
    }

    return url;
}

function getDateTimeString() {
    const d = new Date();

    //
    // The additional ''s are used to force JavaScript to interpret the
    // '+' operator as string concatenation rather than arithmetic.
    //
    return d.getUTCFullYear() + '' +
        makeTwoDigits(d.getUTCMonth() + 1) + '' +
        makeTwoDigits(d.getUTCDate()) + 'T' + '' +
        makeTwoDigits(d.getUTCHours()) + '' +
        makeTwoDigits(d.getUTCMinutes()) + '' +
        makeTwoDigits(d.getUTCSeconds()) + 'Z';
}

function makeTwoDigits(n) {
    if (n > 9) {
        return n;
    } else {
        return '0' + n;
    }
}

function getDateString(dateTimeString) {
    return dateTimeString.substring(0, dateTimeString.indexOf('T'));
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = hmacSHA256(dateStamp, 'AWS4' + key, {
        asBytes: true
    });
    const kRegion = hmacSHA256(regionName, kDate, {
        asBytes: true
    });
    const kService = hmacSHA256(serviceName, kRegion, {
        asBytes: true
    });
    const kSigning = hmacSHA256('aws4_request', kService, {
        asBytes: true
    });
    return kSigning;
}