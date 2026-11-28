/**
 * Generates the app's Web Push (VAPID) key pair and prints how to install it:
 *
 *   npm run push:keys
 *
 * Run it once per deployment. The private key is the project's only secret: it goes into
 * SSM Parameter Store (the command is printed) and nowhere else. Nothing is written to disk.
 * Generating a new pair later invalidates every existing browser subscription.
 */
import * as webPush from 'web-push';

const { publicKey, privateKey } = webPush.generateVAPIDKeys();
console.log(`Web Push key pair generated.

1. Store the private key in SSM Parameter Store (region of the stack):

   aws ssm put-parameter --name /do-re/vapid-private-key --type SecureString --overwrite --value ${privateKey}

2. Deploy with the public key:

   sam deploy --parameter-overrides VapidPublicKey=${publicKey} <your other parameters>

Then clear this terminal's scrollback: the private key is shown above.`);
