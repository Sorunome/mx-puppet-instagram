#!/bin/sh
if [ ! -f "/data/config.yaml" ]; then
	echo "No config found"
	exit 1
fi
if [ ! -f "/data/instagram-registration.yaml" ]; then
	node /opt/mx-puppet-instagram/build/index.js -c /data/config.yaml -f /data/instagram-registration.yaml -r
	echo "Registration generated."
	exit 0
fi
node /opt/mx-puppet-instagram/build/index.js -c /data/config.yaml -f /data/instagram-registration.yaml
