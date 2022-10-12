import {
    AddThingToThingGroupCommand,
    CreateThingCommand,
    CreateThingGroupCommand,
    CreateThingTypeCommand,
    UpdateThingCommand
} from "@aws-sdk/client-iot";
import {AwsIotHomebridgePlatform} from "../platform";
import {encode} from "./stringUtil";
import {getCharacteristicValue, isCapability} from "./characteristicUtil";
import {DiscoveredCharacteristic, DiscoveredService, Homebridge, Thing} from "../types";
import {DEVICE_TYPES} from "./constants";
import {Accessory, Nullable, Service} from "hap-nodejs";
import {UpdateThingShadowCommand} from "@aws-sdk/client-iot-data-plane";


export const createThingGroup = async (platform: AwsIotHomebridgePlatform, groupName: string): Promise<void> => {
    try {
        const thingGroupResponse = await platform.iotClient.send(new CreateThingGroupCommand({
            thingGroupName: groupName
        }));
    } catch (error) {
        // Likely already exists...don't worry about errors. Fail rather than wasting extra API call.
        platform.log.debug(`Caught error creating thing group.`, error);
    }

}

export const createThingType = async (platform: AwsIotHomebridgePlatform, type: string): Promise<void> => {
    try {
        await platform.iotClient.send(new CreateThingTypeCommand({
            thingTypeName: type
        }));
    } catch (error) {
        // Likely already exists...don't worry about errors. Fail rather than wasting extra API call.
        platform.log.debug(`Caught error creating thing type.`, error);
    }
}

const getCharacteristicMap = (service: Service): Map<string, DiscoveredCharacteristic> => {
    // Accessory info is found in the characteristics at service 0.
    // Each service beyond that may have a name override.
    const characteristicMap: Map<string, DiscoveredCharacteristic> = new Map();
    for (const characteristic of service.characteristics) {
        const c = characteristic as DiscoveredCharacteristic;
        if (c.description) {
            characteristicMap.set(c.description, c);
        }
    }
    return characteristicMap;
}

const getDeviceType = (service: DiscoveredService) => {
    let type;
    if (service.type && service.type.length > 8) {
        type = DEVICE_TYPES.get(service.type.substr(0, 8));
    }
    return type ?? 'OTHER';
}

const createThing = async (platform: AwsIotHomebridgePlatform, id: string, name: string, type: string, accessoryInfoMap) => {
    const accessoryInfo = {
        nm: name,
        man: getCharacteristicValue(accessoryInfoMap, 'Manufacturer'),
        sn: getCharacteristicValue(accessoryInfoMap, 'Serial Number'),
        fr: getCharacteristicValue(accessoryInfoMap, 'Firmware Revision'),
        md: getCharacteristicValue(accessoryInfoMap, 'Model'),
    }

    const cmd = new CreateThingCommand({
        thingName: id,
        thingTypeName: type,
        attributePayload: {
            attributes: {
                accessoryInfo: encode(JSON.stringify(accessoryInfo)),
                description: encode(`Discovered via Homebridge AWS IoT plugin`)
            }
        }
    });
    try {
        const response = await platform.iotClient.send(cmd);
        platform.log.debug(`Created thing. ARN: ${response.thingArn}`);
    } catch (error: any) {
        if (error.name === "ResourceAlreadyExistsException") {
            platform.log.debug(`Thing ${id} already exists. Updating`);
            const updateCmd = new UpdateThingCommand({
                ...cmd.input
            });
            await platform.iotClient.send(updateCmd);
            platform.log.debug(`Thing ${id} updated successfully.`)
        } else {
            platform.log.error(`Caught error creating thing.`, error);
            throw error;
        }
    }
}

export const createOrUpdateThings = async (platform: AwsIotHomebridgePlatform, bridge: Homebridge, accessory: Accessory): Promise<ReadonlyArray<Thing>> => {
    const uniqueTypes = new Set<string>();
    const things: Array<Thing> = [];

    if (accessory.services.length < 1) {
        return [];
    }
    const accessoryInfoMap = getCharacteristicMap(accessory.services[0]);
    for (const service of accessory.services) {
        const serviceMap = getCharacteristicMap(service);

        const name = (getCharacteristicValue(serviceMap, 'Name') ??
            getCharacteristicValue(accessoryInfoMap, 'Name')) as string;

        if (!platform.deviceFilterList.has(name.toLowerCase())) {
            platform.log.debug(`Device skipped according to device filter list: ${name}.`);
            continue;
        }
        const id = getThingId(platform, bridge.deviceID, accessory.aid);

        const s = service as DiscoveredService;
        const type = getDeviceType(s);
        if (!uniqueTypes.has(type)) {
            await createThingType(platform, type);
            uniqueTypes.add(type);
        }

        const capabilityValues: Map<string, any> = Array.from(serviceMap.values())
            .filter(it => isCapability(it.type))
            .reduce(function (map, it) {
                map.set(it.description, it.value);
                return map;
            }, new Map());

        if (capabilityValues.size > 0) {
            await createThing(platform, id, name, type, accessoryInfoMap);
            await updateThingShadow(platform, id, capabilityValues);

            things.push({
                id: id,
                name: name,
                bridgeId: bridge.deviceID,
                accessoryId: accessory.aid as number,
                capabilityValues: capabilityValues,
                capabilitySourceMap: new Map(Array.from(serviceMap, ([capability, characteristic]) => [characteristic.iid ?? 0, capability]))
            });
            platform.log.debug(`Thing type, thing, and shadow created successfully. Name: ${name}`);
        } else {
            platform.log.debug(`Ignoring thing without capabilities. Name: ${name}`);
        }
    }
    return things;
}

export const getThingId = (platform: AwsIotHomebridgePlatform, homebridgeId: string, accessoryId: Nullable<number>): string => {
    return encode(`${platform.co.iotIdentifier}~${homebridgeId}~${accessoryId ?? 0}`)
}

export const updateThingShadow = async (platform: AwsIotHomebridgePlatform, thingId: string, capabilityValues: Map<string, any>) => {
    if (!capabilityValues || capabilityValues.size === 0) {
        //TODO: default state values (i.e. closed for contact sensors?)
        platform.log.error(`No capabilities found in updateThingShadow for thing: ${thingId}. Only sending connectivity.`);
    }
    const payload = {
        state: {
            desired: {
                ...Object.fromEntries(capabilityValues),
            },
            reported: {
                ...Object.fromEntries(capabilityValues),
                Connectivity: 'HEALTHY'
            }
        }
    };
    platform.log.debug(`Updating shadow for thing: ${thingId} to ${JSON.stringify(payload)}`);
    const updateShadowCommand = new UpdateThingShadowCommand({
        thingName: thingId,
        payload: Buffer.from(JSON.stringify(payload))
    });
    await platform.iotDataplaneClient.send(updateShadowCommand);
}

export const addThingToGroup = async (platform: AwsIotHomebridgePlatform, thingId: string, groupName: string): Promise<void> => {
    try {
        const addCmd = new AddThingToThingGroupCommand({
            thingName: thingId,
            thingGroupName: groupName
        });
        await platform.iotClient.send(addCmd);
    } catch (error) {
        platform.log.error(`Failed to add thing to group`, error);
    }
}