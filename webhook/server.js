const app = require("express")()
const bodyParser = require("body-parser")
const crypto = require("crypto")
const streamChat = require("stream-chat")
const chatKit = require("@pusher/chatkit-server")
const LRU = require("lru-cache")


const secret = `thesyncim`

function verify(req) {
    const signature = crypto
        .createHmac("sha1", secret)
        .update(req.body)
        .digest("hex")

    return signature === req.get("webhook-signature")
}

/**
 * getStreamClient - returns the Stream Chat client
 *
 * @returns {object}  Stream chat client
 */
function getStreamClient() {
    if (!process.env.STREAM_API_KEY) {
        throw Error('Environment variable STREAM_API_KEY is not defined!');
    }

    if (!process.env.STREAM_API_SECRET) {
        throw Error('Environment variable STREAM_API_SECRET is not defined!');
    }

    const client = new streamChat.StreamChat(
        process.env.STREAM_API_KEY,
        process.env.STREAM_API_SECRET
    );

    return client;
}

/**
 * getChatKitClient - returns the Chat kit client
 *
 * @returns {object}  chat kit client
 */
function getChatKitClient() {
    if (!process.env.CHATKIT_INSTANCE) {
        throw Error('Environment variable CHATKIT_INSTANCE is not defined!');
    }

    if (!process.env.CHATKIT_KEY) {
        throw Error('Environment variable CHATKIT_KEY is not defined!');
    }

    const client = new chatKit.default({
        instanceLocator: process.env.CHATKIT_INSTANCE,
        key: process.env.CHATKIT_KEY
    });

    return client;
}


class StreamSync {
    constructor(streamClient, chatKitClient) {
        const parent = this
        this.streamClient = streamClient;
        this.chatKitClient = chatKitClient;

        this.roomsCache = new LRU(5000) // todo read from env
        this.usersCache = new LRU(5000) // todo read from env

        this.eventHandlers = {
            "v1.rooms_created": function handleRoomsCreatedEvent(event) {
                event.payload.rooms.forEach(async function (room) {
                    await parent.getOrCreateRoom((await parent.getChatKitRoom(room.id, room.created_by_id)))
                })
            },
            "v1.messages_created": function (event) {
                event.payload.messages.forEach(async function (m) {
                    const channel = await parent.getOrCreateRoom((await parent.getChatKitRoom(m.room_id, m.user_id)))
                    await channel.sendMessage(await parent.toStreamMessage(m))
                })
            },
            "v1.messages_deleted": function (event) {
                event.payload.message_ids.forEach(async function (id) {
                    await parent.streamClient().deleteMessage(id.toString())
                })
            },
            "v1.messages_edited": function (event) {
                event.payload.messages.forEach(async function (m) {
                    const updated = await parent.toStreamMessage(m)
                    await parent.streamClient().updateMessage(updated, updated.user_id)
                })
            },
            "v1.users_created": function (event) {
                event.payload.users.forEach(async function (u) {
                    await parent.createStreamUser(u)
                })
            },
            "v1.users_deleted": function (event) {
                event.payload.user_ids.forEach(async function (id) {
                    await parent.streamClient().deleteUser(id, {
                        mark_messages_deleted: false,
                    });
                })
            },
            "v1.users_added_to_room": async function (event) {
                const room = event.payload.room
                const channel = await parent.getOrCreateRoom((await parent.getChatKitRoom(room.id, room.created_by_id)))
                const members = [];
                // ensure users exists
                event.payload.users.forEach(async function (u) {
                    members.push(parent.sanitizeUserId(u.id))
                    await parent.createStreamUser(u)
                })
                await channel.addMembers(members)
            },
            "v1.user_left_room": async function (event) {
                //still not sure whats the diference from v1.users_added_to_room
                const room = event.payload.room
                const channel = await parent.getOrCreateRoom((await parent.getChatKitRoom(room.id, room.created_by_id)))
                const members = [];
                // ensure users exists
                event.payload.users.forEach(async function (u) {
                    members.push(parent.sanitizeUserId(u.id))
                    await parent.createStreamUser(u)
                })
                await channel.removeMembers(members)
            },
            "v1.users_removed_from_room": async function (event) {
                const room = event.payload.room
                const channel = await parent.getOrCreateRoom((await parent.getChatKitRoom(room.id, room.created_by_id)))
                const members = [];
                // ensure usersCache exists
                event.payload.users.forEach(async function (u) {
                    members.push(parent.sanitizeUserId(u.id))
                    await parent.createStreamUser(u)
                })
                await channel.removeMembers(members)
            },
            "v1.rooms_deleted": async function (event) {
                //this is unfortunate, we are probably creating the room right before deleting it
                event.payload.room_ids.forEach(async function (roomId) {
                    // todo implement me
                })
            }
        }
    }

    async getChatKitRoom(roomID, user) {
        const cachedRoom = this.roomsCache.get(roomID)
        if (cachedRoom) {
            return cachedRoom
        }
        const room = await this.chatKitClient().getRoom({
            userId: user,
            roomId: roomID,
        })
        this.roomsCache.set(roomID, room)
        return room
    }

    async ensureMembersExists(ids) {

        const missingIds = []
        const parent = this

        for (let i = 0; i < ids.length; i++) {
            const user = this.usersCache.get(ids[i])
            if (!user) {
                missingIds.push(ids[i])
            }
        }

        // get missing users from cache
        if (missingIds.length > 0) {
            const loadedUsers = await this.chatKitClient().getUsersById({
                userIds: missingIds
            })

            const users = []
            loadedUsers.forEach(function (u) {
                users.push(parent.toStreamUser(u))
            })
            await this.streamClient().updateUsers(users)

            users.forEach(function (u) {
                // update LRU cache
                parent.usersCache.set(u.id, u)
            })
        }
    }

    // sanitizeUserId transform a chatKit user id to a suitable stream user id
    sanitizeUserId(id) {
        // todo improve me
        return id.replace(':', '_')
    }

    // converts a chatKit user to a stream user
    async createStreamUser(chatKitUser) {
        await this.streamClient().updateUser(this.toStreamUser(chatKitUser))
    }

    // converts a chatKit user user to a a stream user
    toStreamUser(chatKitUser) {
        return {
            id: this.sanitizeUserId(chatKitUser.id),
            image: chatKitUser.avatar_url,// todo omit keys with empty values
            name: chatKitUser.name,
            ...chatKitUser.custom_data,
        };
    }

    // converts a chatKit room to a stream channel
    async getOrCreateRoom(room) {
        let type = 'livestream'
        if (room.private) {
            type = 'messaging'
        }

        await this.ensureMembersExists(room.member_user_ids)
        const streamChannel = this.streamClient().channel(type, room.id, {
            name: room.name,
            members: room.member_user_ids,
            created_by_id: room.created_by_id,
            ...room.custom_data
        })
        await streamChannel.create()
        return streamChannel
    }

    // converts a chatKit room to a stream channel
    async toStreamMessage(message) {
        const streamMessage = {
            id: message.id.toString(),
            user_id: message.user_id,
            text: message.text,
            attachments: [],
        }
        const parent = this

        //build attachments
        message.parts.forEach(function (part) {
            // url parts are added to the message body and scrapped server side
            if (part.url) {
                parent.addUrl(streamMessage, part.url)

            } else {
                switch (part.type) {
                    case 'text/plain':
                        streamMessage.text = part.content;
                }
                //todo handle other message parts
            }
        })

        return streamMessage
    }

    addUrl(streamMessage, url) {
        if (streamMessage.text) {
            streamMessage.text += "\n"
            streamMessage.text += url
        } else {
            streamMessage.text = url
        }
    }
}

let streamSync = new StreamSync(getStreamClient, getChatKitClient)

app.use(
    bodyParser.text({
        // Treat body as raw text regardless of content-type
        type: () => true,
    }),
)

app.post("/pusher-webhooks", (req, res) => {
    if (verify(req)) {
        const event = JSON.parse(req.body)
        if (streamSync.eventHandlers[event.metadata.event_type]) {
            try {
                streamSync.eventHandlers[event.metadata.event_type](event)
            } catch (e) {
                console.log(`error: ${event.metadata.event_type}\n request body:${req.body}`)
            }
        } else {
            console.log(`error: No event handler defined for: ${event.metadata.event_type}`)
        }
        res.sendStatus(200)
    } else {
        console.log("Got an unverified request; ignoring.")
        res.sendStatus(401)
    }
})

app.listen(5000, () => console.log("listening on :5000"))


