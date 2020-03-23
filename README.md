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



