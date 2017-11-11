/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

/**
 * Triggers when a user gets a new message and sends a notification.
 *
 * Messages are created to `/messages/{uid}/inbox`.
 * Users save their device notification tokens to `/users/{uid}/notificationTokens/{notificationToken}`.
 */
exports.sendMessageNotification = functions.database.ref('/messages/{uid}/inbox/{messageId}').onWrite(event => {
  const uid = event.params.uid;
  const message = event.data.val();
  
  if (message == null) {
    console.log('Message is NULL (removed), not sending notifications.');
    return;
  }

  console.log('We have a new message from UID:', message.sender, 'for user:', uid);

  // Get the list of device notification tokens.
  const getDeviceTokensPromise = admin.database().ref(`/users/${uid}/notificationTokens`).once('value');

  // Get the follower profile.
  const getFollowerProfilePromise = admin.auth().getUser(message.sender);

  return Promise.all([getDeviceTokensPromise, getFollowerProfilePromise]).then(results => {
    const tokensSnapshot = results[0];
    const sender = results[1];

    // Check if there are any device tokens.
    if (!tokensSnapshot.hasChildren()) {
      return console.log('There are no notification tokens to send to.');
    }

    console.log('There are', tokensSnapshot.numChildren(), 'tokens to send notifications to.');
    console.log('Fetched sender profile', sender);

    // Notification details.
    const payload = {
      notification: {
        title: 'You have a new message',
        body: `${sender.displayName} sent you a message.`,
        icon: sender.photoURL
      }
    };

    // Listing all tokens.
    const tokens = Object.keys(tokensSnapshot.val());

    // Send notifications to all tokens.
    return admin.messaging().sendToDevice(tokens, payload).then(response => {
      // For each message check if there was an error.
      const tokensToRemove = [];
      response.results.forEach((result, index) => {
        const error = result.error;
        if (error) {
          console.error('Failure sending notification to', tokens[index], error);
          // Cleanup the tokens who are not registered anymore.
          if (error.code === 'messaging/invalid-registration-token' ||
              error.code === 'messaging/registration-token-not-registered') {
            tokensToRemove.push(tokensSnapshot.ref.child(tokens[index]).remove());
          }
        }
      });
      return Promise.all(tokensToRemove);
    });
  });
});
