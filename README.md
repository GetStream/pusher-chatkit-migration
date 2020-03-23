# Pusher Chatkit Migration

Guide on how to Migrate Pusher Chatkit to Stream's [Chat API](https://getstream.io/chat/)
Pusher has decided to shutdown their chat API by April 23rd. This gives their customers 30 days to pull of a complicated migration. 

If you need help be sure to contact support@getstream.io

## Step 1 - Downloading your export

1. Download your Chatkit export from the [Pusher Dashboard](https://dashboard.pusher.com/). 
2. Create an account on [getstream.io](https://getstream.io/)
3. Email support@getstream.io with your Pusher export to get an import started. This typically takes 1 business day. At the moment it might take a bit more time since all Pusher customers need to migrate. That's why we recommend doing this as the first step.

## Step 2 - Follow one of Stream's tutorials

- [React Chat Tutorial](https://getstream.io/chat/react-chat/tutorial/)
- [React Native Chat tutorial](https://getstream.io/chat/react-native-chat/tutorial/)
- [Flutter Chat Tutorial](https://getstream.io/chat/flutter/tutorial/)
- [Kotlin Chat Tutorial](https://getstream.io/tutorials/android-chat/#kotlin)
- [Swift Chat Tutorial](https://getstream.io/tutorials/ios-chat/)

Most of the integration with Chat is typically done on the frontend. Typically only token generation is done server side.
SDKs are available for PHP, Python, Go, Ruby, Java, JS and Dart.

## Step 3 - Integrate Stream's chat

You'll want to make sure your chat solution works. We've seen customers integrate in as little as 2 days. Though the complexity of this integration really depends on how many platforms you're supporting and how complicated your chat is.

# Differences between Stream & Pusher

Stream supports all the features you're used to from Pusher. The biggest engineering/conceptual differences are:

* Pusher has the concept of private and public rooms. Stream has channels. There are 5 built-in types of channels. The "messaging" channel type is similar to the private room. The "livestream" channel type is similar to the public room. You can also create your own channel types. The channel types allow you to configure permissions (IE you need to be a member of a channel in order to post messages). The channel type also allows you to enable/disable features such as typing indicators etc. [Channel Type Docs](https://getstream.io/chat/docs/channel_features/?language=js)
* Authorization/Tokens. Stream uses token based authentication. When the user registers or logins your backend will generate a token. This token gives the client side integration access to the chat for that user. Pusher uses a authorization URL based approach. [Token Generation](https://getstream.io/chat/docs/init_and_users/?language=js&q=token#tokens)

# Product Differences

* Stream powers chat and feeds for over 500 million end users. We believe in building products to last and you can feel confident relying on our APIs. On enterprise deals we also have a code escrow clause in place to ensure you never end up in a situation like we're seeing right now with Pusher.
* [API uptime](http://status.getstream.io/), Stream's API has near 100% uptime. On enterprise plans we offer a 99.999% uptime SLA
* Reactions, Threads and Rich URL previews are supported out of the box
* Unread counts are available at a per channel as well as per member level



