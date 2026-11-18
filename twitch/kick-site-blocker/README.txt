Kick website blocker

1. Extract the ZIP to a permanent folder.
2. In desktop Chrome, open chrome://extensions and enable Developer mode.
3. Choose Load unpacked and select the kick-site-blocker folder.
4. Confirm that https://kick.com/ is blocked by the extension before changing the hosts file.
5. Remove only the kick.com and www.kick.com mappings from /etc/hosts.

The blocker applies in Chrome profiles where it is installed and enabled. Hosts-file blocking is system-wide. Other browsers will need their own blocker.

The player at player.kick.com needs to fetch channel information from kick.com. This extension blocks top-level navigation to Kick pages while allowing those API requests.

The Twitch hosts mappings do not need to change for this Kick fix.
