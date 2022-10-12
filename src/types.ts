import {Accessory, Service} from 'hap-nodejs';
import {Characteristic} from 'homebridge';

export type HomebridgeConnection = {
    readonly host: string;
    readonly port: string;
    readonly url: string;
};

//Ugh..why?
export type AccessoryWrapper = {
    readonly accessories: ReadonlyArray<Accessory>;
};

export type Homebridge = {
    readonly name: string;
    readonly deviceID: string;
    readonly ipAddress: string;
    readonly instance: HomebridgeConnection;
    readonly accessories: AccessoryWrapper;
};

export type DiscoveredService = {
    readonly type: string;
} & Service;

export type DiscoveredCharacteristic = {
    readonly type: string;
    readonly description: string;
} & Characteristic;

export type EventCharacteristic = {
    readonly aid: number;
    readonly iid: number;
    readonly ev: boolean;
};

export type HAPEvent = {
    readonly host: string;
    readonly port: number;
    readonly deviceID: string;
    readonly aid: number;
    readonly iid: number;
    readonly value: any;
    readonly status: boolean;
};

export type Thing = {
    readonly id: string;
    readonly bridgeId: string;
    readonly accessoryId: number;
    readonly name: string;
    readonly capabilityValues: Map<string, any>;
    readonly capabilitySourceMap: Map<number, string>; //Map of service iid to capability name.
};
