import {DiscoveredCharacteristic} from "../types";
import {CHARACTERISTIC_CAPABILITY_UUIDS} from "./constants";

export const getCharacteristicValue = function (charMap: Map<string, DiscoveredCharacteristic>, name: string) {
    return charMap.get(name)?.value ?? 'Unknown';
}

export const isCapability = function(characteristicUuid: string): boolean {
    return CHARACTERISTIC_CAPABILITY_UUIDS.has(characteristicUuid);
}