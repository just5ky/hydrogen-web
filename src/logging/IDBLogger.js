/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {
    openDatabase,
    txnAsPromise,
    reqAsPromise,
    iterateCursor,
    fetchResults,
    encodeUint64
} from "../matrix/storage/idb/utils.js";
import {BaseLogger} from "./BaseLogger.js";

export class IDBLogger extends BaseLogger {
    constructor(options) {
        super(options);
        const {name, flushInterval = 60 * 1000, limit = 3000} = options;
        this._name = name;
        this._limit = limit;
        // does not get loaded from idb on startup as we only use it to
        // differentiate between two items with the same start time
        this._itemCounter = 0;
        this._queuedItems = this._loadQueuedItems();
        // TODO: also listen for unload just in case sync keeps on running after pagehide is fired?
        window.addEventListener("pagehide", this, false);
        this._flushInterval = this._platform.clock.createInterval(() => this._tryFlush(), flushInterval);
    }

    dispose() {
        window.removeEventListener("pagehide", this, false);
        this._flushInterval.dispose();
    }

    handleEvent(evt) {
        if (evt.type === "pagehide") {
            this._finishAllAndFlush();
        }
    }

    async _tryFlush() {
        const db = await this._openDB();
        try {
            const txn = db.transaction(["logs"], "readwrite");
            const logs = txn.objectStore("logs");
            const amount = this._queuedItems.length;
            for(const i of this._queuedItems) {
                logs.add(i);
            }
            const itemCount = await reqAsPromise(logs.count());
            if (itemCount > this._limit) {
                // delete an extra 10% so we don't need to delete every time we flush
                let deleteAmount = (itemCount - this._limit) + Math.round(0.1 * this._limit);
                await iterateCursor(logs.openCursor(), (_, __, cursor) => {
                    cursor.delete();
                    deleteAmount -= 1;
                    return {done: deleteAmount === 0};
                });
            }
            await txnAsPromise(txn);
            this._queuedItems.splice(0, amount);
        } catch (err) {
            console.error("Could not flush logs", err);
        } finally {
            try {
                db.close();
            } catch (e) {}
        }
    }

    _finishAllAndFlush() {
        this._finishOpenItems();
        this._persistQueuedItems(this._queuedItems);
    }

    _loadQueuedItems() {
        const key = `${this._name}_queuedItems`;
        try {
            const json = window.localStorage.getItem(key);
            if (json) {
                window.localStorage.removeItem(key);
                return JSON.parse(json);
            }
        } catch (err) {
            console.error("Could not load queued log items", err);
        }
        return [];
    }

    _openDB() {
        return openDatabase(this._name, db => db.createObjectStore("logs", {keyPath: "id"}), 1);
    }
    
    _persistItem(serializedItem) {
        this._itemCounter += 1;
        this._queuedItems.push({
            id: `${encodeUint64(serializedItem.s)}:${this._itemCounter}`,
            json: JSON.stringify(serializedItem)
        });
    }

    _persistQueuedItems(items) {
        try {
            window.localStorage.setItem(`${this._name}_queuedItems`, JSON.stringify(items));
        } catch (e) {
            console.error("Could not persist queued log items in localStorage, they will likely be lost", e);
        }
    }

    async export() {
        const db = await this._openDB();
        try {
            const txn = db.transaction(["logs"], "readonly");
            const logs = txn.objectStore("logs");
            const storedItems = await fetchResults(logs.openCursor(), () => false);
            const allItems = storedItems.concat(this._queuedItems);
            const sortedItems = allItems.sort((a, b) => {
                return a.id > b.id;
            });
            return new IDBLogExport(sortedItems, this, this._platform);
        } finally {
            try {
                db.close();
            } catch (e) {}
        }
    }

    async _removeItems(items) {
        const db = await this._openDB();
        try {
            const txn = db.transaction(["logs"], "readwrite");
            const logs = txn.objectStore("logs");
            for (const item of items) {
                const queuedIdx = this._queuedItems.findIndex(i => i.id === item.id);
                if (queuedIdx === -1) {
                    logs.delete(item.id);
                } else {
                    this._queuedItems.splice(queuedIdx, 1);
                }
            }
            await txnAsPromise(txn);
        } finally {
            try {
                db.close();
            } catch (e) {}
        }
    }
}

class IDBLogExport {
    constructor(items, logger, platform) {
        this._items = items;
        this._logger = logger;
        this._platform = platform;
    }
    
    get count() {
        return this._items.length;
    }

    /**
     * @return {Promise}
     */
    removeFromStore() {
        return this._logger._removeItems(this._items);
    }

    asBlob() {
        const log = {
            formatVersion: 1,
            appVersion: this._platform.updateService?.version,
            items: this._items.map(i => JSON.parse(i.json))
        };
        const json = JSON.stringify(log);
        const buffer = this._platform.encoding.utf8.encode(json);
        const blob = this._platform.createBlob(buffer, "application/json");
        return blob;
    }
}
