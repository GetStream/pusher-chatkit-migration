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

        this.rooms = new LRU(5000)
        this.users = new LRU(5000)

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
                    await parent.streamClient().deleteUser(id.toString())
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
                    await parent.handleCreateUser(u)
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
                    await parent.handleCreateUser(u)
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
                    await parent.handleCreateUser(u)
                })
                await channel.removeMembers(members)
            },
            "v1.users_removed_from_room": async function (event) {
                const room = event.payload.room
                const channel = await parent.getOrCreateRoom((await parent.getChatKitRoom(room.id, room.created_by_id)))
                const members = [];
                // ensure users exists
                event.payload.users.forEach(async function (u) {
                    members.push(parent.sanitizeUserId(u.id))
                    await parent.handleCreateUser(u)
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
        const cachedRoom = this.rooms.get(roomID)
        if (cachedRoom) {
            return cachedRoom
        }
        const room = await this.chatKitClient().getRoom({
            userId: user,
            roomId: roomID,
        })
        await this.ensureUsersCreated(room.member_user_ids)
        this.rooms.set(roomID, room)
        return room
    }

    async ensureUsersCreated(ids) {
        // get missing users
        const missingIds = []

        for (let i = 0; i < ids.length; i++) {
            const user = this.users.get(ids[i])
            if (!user) {
                missingIds.push(ids[i])
            }
        }
        if (missingIds.length > 0) {
            const loadedUsers = await this.chatKitClient().getUsersById({
                userIds: missingIds
            })
            console.log(loadedUsers)
            const parent = this
            const users = []
            loadedUsers.forEach(function (u) {
                users.push(parent.toStreamUser(u))
            })
            await this.streamClient().updateUsers(users)

            users.forEach(function (u) {
                parent.users.set(u.id,u)
            })
        }
    }

    sanitizeUserId(id) {
        // todo improve me
        return id.replace(':', '_')
    }

    // converts a chatKit user to a stream user
    async handleCreateUser(chatKitUser) {
        await this.streamClient().updateUser(toStreamUser(user))
    }

    toStreamUser(chatKitUser){
        return  {
            id: this.sanitizeUserId(chatKitUser.id),
            image: chatKitUser.profile_image,// todo omit keys with empty values
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

        //build attachments
        message.parts.forEach(function (part) {
            if (part.url) {

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
}

let wrapper = new StreamSync(getStreamClient, getChatKitClient)

app.use(
    bodyParser.text({
        // Treat body as raw text regardless of content-type
        type: () => true,
    }),
)

app.post("/pusher-webhooks", (req, res) => {
    if (verify(req)) {
        // console.log("Got a request with body", req.body)
        const event = JSON.parse(req.body)
        console.log(req.body)
        console.log("\n")
        if (wrapper.eventHandlers[event.metadata.event_type]) {
            wrapper.eventHandlers[event.metadata.event_type](event)
        }
        res.sendStatus(200)
    } else {
        console.log("Got an unverified request; ignoring.")
        res.sendStatus(401)
    }
})

app.listen(5000, () => console.log("listening on :5000"))


