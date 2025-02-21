import { MessageType, validateMessage } from "../utils/messenger";
import { RootState } from "../stores/reducers";
import { IPermissionState } from "../stores/reducers/permissions";
import { IArweave, defaultConfig } from "../stores/reducers/arweave";
import { PermissionType } from "./permissions";
import { getRealURL } from "./url";
import { browser } from "webextension-polyfill-ts";
import { run } from "ar-gql";
import limestone from "@limestonefi/api";
import Arweave from "arweave";
import axios from "axios";

/**
 * Create an authenticator popup
 *
 * @param data The data sent to the popup
 *
 * @returns AuthPopup window
 */
export const createAuthPopup = (data: any) =>
  browser.windows.create({
    url: `${browser.extension.getURL("auth.html")}?auth=${encodeURIComponent(
      JSON.stringify(data)
    )}`,
    focused: true,
    type: "popup",
    width: 385,
    height: 635
  });

/** Permission utilities */

/**
 * Check permissions for an application
 *
 * @param permissions Permissions to check for
 * @param url App URL
 *
 * @returns if the app has the checked permissions
 */
export async function checkPermissions(
  permissions: PermissionType[],
  url: string
) {
  const storedPermissions = await getPermissions(url);

  if (storedPermissions.length > 0) {
    for (const permission of permissions)
      if (!storedPermissions.includes(permission)) return false;

    return true;
  } else return false;
}

/**
 * Get permissions for an application
 *
 * @param url App URL
 *
 * @returns Permissions for the app
 */
export async function getPermissions(url: string): Promise<PermissionType[]> {
  const storedPermissions = (await getStoreData())?.["permissions"];
  url = getRealURL(url);

  if (!storedPermissions) return [];

  const sitePermissions: PermissionType[] =
    storedPermissions.find((val: IPermissionState) => val.url === url)
      ?.permissions ?? [];

  return sitePermissions;
}

/** Store data related functions */

export type StoreData = Partial<RootState>;

/**
 * Get store data
 *
 * @returns StoreData
 */
export async function getStoreData(): Promise<StoreData> {
  const data = (await browser.storage.local.get("persist:root"))?.[
      "persist:root"
    ],
    parseRoot: StoreData = JSON.parse(data ?? "{}");

  let parsedData: StoreData = {};
  // @ts-ignore
  for (const key in parseRoot) parsedData[key] = JSON.parse(parseRoot[key]);

  return parsedData;
}

/**
 * Set store data
 *
 * @param updatedData An object with the reducer name as a key
 */
export async function setStoreData(updatedData: StoreData) {
  const data = { ...(await getStoreData()), ...updatedData };
  // store data, but with stringified values
  let encodedData: { [key: string]: string } = {};

  for (const reducer in data) {
    // @ts-ignore
    encodedData[reducer] = JSON.stringify(data[reducer]);
  }

  await browser.storage.local.set({
    "persist:root": JSON.stringify(encodedData)
  });
}

/**
 * Calculate the fee amount needed for a signing
 *
 * @param address The address to base off the calculation
 * @param arweave Arweave client
 *
 * @returns Fee amount in string
 */
export async function getFeeAmount(address: string, arweave: Arweave) {
  const res = await run(
    `
      query($address: String!) {
        transactions(
          owners: [$address]
          tags: [
            { name: "App-Name", values: "ArConnect" }
            { name: "Type", values: "Fee-Transaction" }
          ]
          first: 11
        ) {
          edges {
            node {
              id
            }
          }
        }
      }
    `,
    { address }
  );

  let arPrice = 0;

  try {
    const res = await limestone.getPrice("AR");
    arPrice = res.price;
  } catch {
    const { data: res } = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd"
    );
    arPrice = res.arweave.usd;
  }

  const usdPrice = 1 / arPrice; // 1 USD how much AR

  if (res.data.transactions.edges.length) {
    const usd = res.data.transactions.edges.length >= 10 ? 0.01 : 0.03;

    return arweave.ar.arToWinston((usdPrice * usd).toString());
  } else return arweave.ar.arToWinston((usdPrice * 0.01).toString());
}

/**
 * Check if any wallets are in the local storage
 */
export async function walletsStored(): Promise<boolean> {
  try {
    const wallets = (await getStoreData())?.["wallets"];

    if (!wallets || wallets.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate the user.
 * Opens an auth window if the user has not authenticated
 * themselves.
 *
 * @param action Reason of the auth request
 * @param tabURL The URL of the current app
 */
export const authenticateUser = (action: MessageType, tabURL: string) =>
  new Promise<void>(async (resolve, reject) => {
    try {
      const decryptionKey = (await browser.storage.local.get("decryptionKey"))
        ?.decryptionKey;
      if (decryptionKey) return resolve();

      createAuthPopup({
        type: action,
        url: tabURL
      });
      browser.runtime.onMessage.addListener(async (msg) => {
        if (
          !validateMessage(msg, {
            sender: "popup",
            type: `${action}_result` as MessageType
          }) ||
          !msg.decryptionKey ||
          !msg.res
        )
          reject();
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });

/**
 * Get the currently active browser tab
 *
 * @returns Active tab object
 */
export async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error("No tabs opened");
  else return tabs[0];
}

/**
 * Get the custom Arweave config from the
 * browser's storage
 *
 * @returns Arweave config object
 */
export async function getArweaveConfig(): Promise<IArweave> {
  try {
    const storage = await getStoreData();
    return storage.arweave ?? defaultConfig;
  } catch {
    return defaultConfig;
  }
}
