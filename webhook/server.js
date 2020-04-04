const app = require("express")()
const bodyParser = require("body-parser")
const crypto = require("crypto")
const streamChat = require("stream-chat")
const chatKit = require("@pusher/chatkit-server")

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
        // todo use LRU cache so we dont go OOM :)
        this.roomIDToRoomObject = {};

        this.eventHandlers = {
            "v1.rooms_created": function handleRoomsCreatedEvent(event) {
                event.payload.rooms.forEach(async function (room) {
                    await parent.getOrCreateRoom((await parent.getChatKitRoom(room.id, room.created_by_id)))
                })
            },
            "v1.messages_created": function (event) {
                event.payload.messages.forEach(async function (m) {
                    await parent.handleCreateMessage(m)
                })
            },
            "v1.users_created": function (event) {
                event.payload.users.forEach(async function (u) {
                    await parent.handleCreateUser(u)
                })
            },
            "v1.users_added_to_room": async function (event) {
                const channel = await parent.getOrCreateRoom(event.payload.room)
                let members = [];
                event.payload.users.forEach(async function (u) {
                    members.push(parent.sanitizeUserId(u.id))
                    await parent.handleCreateUser(u)
                })
                await channel.addMembers(members)
            }
        }
    }

    async getChatKitRoom(roomID, user) {
        if (this.roomIDToRoomObject[roomID]) {
            return this.roomIDToRoomObject[roomID]
        }
        const room = await this.chatKitClient().getRoom({
            userId: user,
            roomId: roomID,
        })
        this.roomIDToRoomObject[roomID] = room
        return room
    }

    sanitizeUserId(id) {
        // todo improve me
        return id.replace(':', '_')
    }

    // converts a chatKit user to a stream user
    async handleCreateUser(chatKitUser) {
        const user = {
            id: this.sanitizeUserId(chatKitUser.id),
            image: chatKitUser.profile_image,// todo omit keys with empty values
            name: chatKitUser.name,
            ...chatKitUser.custom_data,
        };
        await this.streamClient().updateUser(user)
    }

    // converts a chatKit room to a stream channel
    async getOrCreateRoom(room) {
        let type = 'livestream'
        if (room.private) {
            type = 'messaging'
        }
        //todo ensure that members exist
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
    async handleCreateMessage(message) {
        const channel = await this.getOrCreateRoom((await this.getChatKitRoom(message.room_id, message.user_id)))

        const streamMessage = {
            id: message.id.toString(),
            user_id: message.user_id,
            text: message.text,
            attachments: [],
        }

        //build attachments
        message.parts.forEach(function (part) {
            switch (part.type) {
                case 'text/plain':
                    streamMessage.text = part.content;
            }
        })

        await channel.sendMessage(streamMessage)
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
        console.log(event.metadata)
        console.log(event.payload)
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


