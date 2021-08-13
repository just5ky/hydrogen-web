/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import {MIN_UNICODE, MAX_UNICODE} from "./common";
import {Store} from "../Store";

function encodeKey(roomId: string, sessionId: string, messageIndex: number | string): string {
    return `${roomId}|${sessionId}|${messageIndex}`;
}

interface GroupSessionDecryption {
    eventId: string;
    timestamp: number;
    key: string;
}

export class GroupSessionDecryptionStore {
    private _store: Store<GroupSessionDecryption>;

    constructor(store: Store<GroupSessionDecryption>) {
        this._store = store;
    }

    get(roomId: string, sessionId: string, messageIndex: number): Promise<GroupSessionDecryption | null> {
        return this._store.get(encodeKey(roomId, sessionId, messageIndex));
    }

    set(roomId: string, sessionId: string, messageIndex: number, decryption: GroupSessionDecryption): Promise<IDBValidKey> {
        decryption.key = encodeKey(roomId, sessionId, messageIndex);
        return this._store.put(decryption);
    }
    
    removeAllForRoom(roomId: string): Promise<undefined> {
        const range = this._store.IDBKeyRange.bound(
            encodeKey(roomId, MIN_UNICODE, MIN_UNICODE),
            encodeKey(roomId, MAX_UNICODE, MAX_UNICODE)
        );
        return this._store.delete(range);
    }
}
