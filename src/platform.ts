import {
    API,
    DynamicPlatformPlugin,
    Logger,
    PlatformAccessory,
    PlatformConfig,
} from 'homebridge';

import {HAPNodeJSClient} from 'hap-node-client';
import {EventCharacteristic, HAPEvent, Homebridge, Thing} from './types';
import {IoTClient} from '@aws-sdk/client-iot';
import {encode} from './util/stringUtil';
import {prepareWebSocketUrl} from './util/awsUtil';
import {addThingToGroup, createOrUpdateThings, createThingGroup, getThingId, updateThingShadow} from './util/iotUtil';
import {IoTDataPlaneClient} from '@aws-sdk/client-iot-data-plane';
import EventEmitter from 'events';
import {Accessory} from 'hap-nodejs';
import {IClientOptions, MqttClient} from 'mqtt/types/lib/client';
import * as mqtt from 'mqtt';

type DeviceFilter = {
    readonly name: string;
    readonly displayCategory: string;
};

type PluginConfig = {
    readonly pin: string;
    readonly debug: boolean;
    readonly awsRegion: string;
    readonly awsIamAccessKey: string;
    readonly awsIamSecret: string;
    readonly iotIdentifier: string;
    readonly iotEndpoint: string;
    readonly deviceFilterList: ReadonlyArray<DeviceFilter>;
} & PlatformConfig;

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class AwsIotHomebridgePlatform implements DynamicPlatformPlugin {
    configureAccessory(accessory: PlatformAccessory): void {
        this.log.debug(`Configuring accessory ${accessory}. Shouldn't be here.`);
    }

    public readonly co: PluginConfig;
    public readonly iotClient: IoTClient | null;
    public readonly iotDataplaneClient: IoTDataPlaneClient | null;
    public readonly eventBus: EventEmitter;
    private readonly hapClient: HAPNodeJSClient;
    private readonly thingMap: Map<string, Thing>;
    public readonly mqttClient: MqttClient | null;
    public readonly deviceFilterList: Map<string, string>;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.log.debug('Finished initializing platform:', this.config.name);

        this.eventBus = new EventEmitter();
        this.thingMap = new Map();
        this.co = config as PluginConfig;
        try {
            this.deviceFilterList = this.co.deviceFilterList ? this.co.deviceFilterList.reduce((map, it) => {
                map.set(it.name.toLowerCase(), it.displayCategory);
                return map;
            }, new Map()) : new Map();

            this.iotClient = new IoTClient({
                region: this.co.awsRegion,
                credentials: {
                    accessKeyId: this.co.awsIamAccessKey,
                    secretAccessKey: this.co.awsIamSecret,
                },
            });
            this.iotDataplaneClient = new IoTDataPlaneClient({
                region: this.co.awsRegion,
                credentials: {
                    accessKeyId: this.co.awsIamAccessKey,
                    secretAccessKey: this.co.awsIamSecret,
                },
            });

            const presignedURL = prepareWebSocketUrl(this.getUrlSignatureOptions());
            const mqttOptions: IClientOptions = {
                keepalive: 30,
                reconnectPeriod: 1000,
                clientId: `homebridge-${this.co.iotIdentifier}`,
                clean: true,
                connectTimeout: 5000,
                transformWsUrl: () => {
                    this.log.info('Refreshing URL signature.');
                    return prepareWebSocketUrl(this.getUrlSignatureOptions());
                },
            };

            this.mqttClient = mqtt.connect(presignedURL, mqttOptions);
            this.mqttClient.on('connect', () => {
                this.log.debug('MQTT connected successfully.');
            });

            this.mqttClient.on('error', (error) => {
                this.log.error('Caught error on MQTT connection', error);
            });
            this.mqttClient.on('close', (error) => {
                this.log.error('Caught close on MQTT connection', error);
            });
            this.mqttClient.on('disconnect', (error) => {
                this.log.error('Caught disconnect on MQTT connection', error);
            });
            this.mqttClient.on('end', (error) => {
                this.log.error('Caught end on MQTT connection', error);
            });

            this.mqttClient.on('message', this.handleMqttMessage.bind(this));

            // https://github.com/NorthernMan54/Hap-Node-Client/blob/master/docs/API.md#properties
            const hapClientOptions = {
                debug: this.co.debug,
                pin: this.co.pin,
                eventBus: this.eventBus,
                refresh: 1440, //1 day
            };
            this.hapClient = new HAPNodeJSClient(hapClientOptions);
            this.hapClient.on('Ready', this.handleHomebridgeDiscovery.bind(this));
            this.hapClient.on('hapEvent', this.hapEvent.bind(this));


            // When this event is fired it means Homebridge has restored all cached accessories from disk.
            // Dynamic Platform plugins should only register new accessories after this event was fired,
            // in order to ensure they weren't added to homebridge already. This event can also be used
            // to start discovery of new accessories.
            this.api.on('didFinishLaunching', async () => {
                log.debug('Executed didFinishLaunching callback');
            });
        } catch (error) {
            log.error('Caught error launching. AWS IOT plugin could not be initialized.', error);
            this.deviceFilterList = new Map();
            this.iotClient = null;
            this.iotDataplaneClient = null;
            this.mqttClient = null;
        }
    }

    getUrlSignatureOptions() {
        return {
            host: this.co.iotEndpoint,
            region: this.co.awsRegion,
            username: this.co.awsIamAccessKey,
            password: this.co.awsIamSecret,
        };
    }

    async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
        const payloadString = payload.toString();
        const thingId = topic.split('/')[2];
        this.log.debug(`Received MQTT message for thing: ${thingId}. Payload: ${payloadString}`);
        const json = JSON.parse(payloadString);
        const thing = this.thingMap.get(thingId) as Thing;
        const characteristics = Array.from(thing.capabilitySourceMap, ([key, value]) => {
            if (Object.prototype.hasOwnProperty.call(json.state, value)) {
                return {
                    aid: thing.accessoryId,
                    iid: key,
                    value: json.state[value],
                };
            }
            return null;
        }).filter(it => it);
        const body = JSON.stringify({
            characteristics: characteristics,
        });
        this.log.info(`Setting ${thing.name} state per MQTT message: ${JSON.stringify(characteristics)}`);
        this.hapClient.HAPcontrolByDeviceID(thing.bridgeId, body, (err) => {
            if (err) {
                this.log.error('Failed to set device state: ', err);
            } else {
                this.log.debug('Successfully set device state.');
            }
        });

    }

    async handleHomebridgeDiscovery(homebridges: ReadonlyArray<any>) {
        try {
            if (this.mqttClient === null) {
                this.log.info('MQTT client is null. Skipping discovery');
                return;
            }
            this.thingMap.clear();
            this.log.debug(`Discovered ${homebridges.length} homebridges. Sending to IoT...`);
            let count = 0;
            const groupName = encode(this.co.iotIdentifier);
            await createThingGroup(this, groupName);

            for (const homebridge of homebridges) {
                const characteristicsForEvents: Array<EventCharacteristic> = [];
                const h = homebridge as Homebridge;
                for (const accessory of h.accessories.accessories) {
                    const things = await createOrUpdateThings(this, h, accessory);
                    for (const thing of things) {
                        this.thingMap.set(thing.id, thing);
                        await addThingToGroup(this, thing.id, groupName);
                        characteristicsForEvents.push(...this.getCharacteristicsForEvents(accessory));
                        const topic = `$aws/things/${thing.id}/shadow/update/delta`;
                        this.log.debug(`Subscribing to topic: ${topic}`);
                        await this.mqttClient.subscribe(topic, (err) => {
                            if (err) {
                                this.log.error('Failed to subscribe to MQTT message. Incoming IoT messages will not work!', err);
                            } else {
                                this.log.debug(`Finished subscribing to topic: ${topic}`);
                            }
                        });
                        count++;
                    }
                }
                this.registerForEvents(homebridge, characteristicsForEvents);
            }
            this.log.info(`Discovery completed successfully. ${count} devices sent to IOT.`);
        } catch (error) {
            this.log.error('Failed to discover all the things', error);
        }
    }

    getCharacteristicsForEvents(accessory: Accessory): ReadonlyArray<EventCharacteristic> {
        const characteristicsForEvents: Array<EventCharacteristic> = [];
        for (const service of accessory.services) {
            for (const characteristic of service.characteristics) {
                if (accessory.aid && characteristic.iid) {
                    characteristicsForEvents.push({
                        aid: accessory.aid,
                        iid: characteristic.iid,
                        ev: true,
                    });
                }
            }
        }
        return characteristicsForEvents;
    }

    registerForEvents(homebridge: Homebridge, characteristics: ReadonlyArray<EventCharacteristic>) {
        this.hapClient.HAPeventByDeviceID(homebridge.deviceID, JSON.stringify({
            characteristics: characteristics,
        }), (error) => {
            if (error) {
                this.log.debug(`Failed to register for events for bridge ${homebridge.deviceID}: `,
                    error.message);
            } else {
                this.log.debug(`Registered for events successfully for bridge: ${homebridge.deviceID}`);
                // TODO: status has characteristics. Push?
            }
        });
    }

    async hapEvent(events: Array<HAPEvent>) {
        try {
            this.log.debug(`hapEvents: ${this.json(events)}`);
            for (const event of events) {
                const id = getThingId(this, event.deviceID, event.aid);
                const thing = this.thingMap.get(id);
                if (thing) {
                    const capability = thing.capabilitySourceMap.get(event.iid) as string;
                    const capabilityMap = new Map([
                        [capability, event.value],
                    ]);
                    this.log.info(`Updating IoT shadow for ${thing.name}. ${capability} transitioned to ${event.value}`);
                    await updateThingShadow(this, id, capabilityMap);
                } else {
                    this.log.error(`Can't handle event. Couldn't find thing for ID: ${id} in thing map.`);
                }
            }
        } catch (err) {
            this.log.error('Caught error handling HAP event.', err);
        }
    }

    json(data) {
        return JSON.stringify(data, null, 2);
    }
}
