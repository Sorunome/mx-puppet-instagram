[![Support room on Matrix](https://img.shields.io/matrix/mx-puppet-bridge:sorunome.de.svg?label=%23mx-puppet-bridge%3Asorunome.de&logo=matrix&server_fqdn=sorunome.de)](https://matrix.to/#/#mx-puppet-bridge:sorunome.de) [![donate](https://liberapay.com/assets/widgets/donate.svg)](https://liberapay.com/Sorunome/donate)

# mx-puppet-instagram
This is an instagram puppeting bridge for matrix. It is based on [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge).

## building and installation

To use the bridge outside a docker container, the following method can be used.

They have been tested on Ubuntu linux, but the steps in general should be adapatable to must Unix-like systems without many changes.
The following config assumes bridge and synapse is running on the same host/container.

````shell
# install global dependencies
# NodeJS version 12 or newer required for sqlite3 support!
apt install sqlite3 nodejs wget

# obtain bridge
mkdir -p $HOME/bridges
cd $HOME/bridges
git clone https://github.com/Sorunome/mx-puppet-instagram
cd mx-puppet-instagram

# obtain sample config, customize
wget -O config.yaml https://raw.githubusercontent.com/Sorunome/mx-puppet-bridge/master/sample.config.yaml
nano config.yaml

# get dependencies
npm install

# compile typescript-code to javascript
npm run build

# generate registration file, deploy. adapt as needed
npm start -r
sudo cp instagram-registration.yaml /etc/matrix-synapse/
sudo chown matrix-synapse /etc/matrix-synapse/instagram-registration.yaml 

# manually add registration to synapse daemon. adapat as needed
sudo nano /etc/matrix-synapse/homeserver.yaml 

# restart matrix daemon
sudo systemctl restart matrix-synapse

# run actual bridge
npm start

# Out of scope: make it run as a persistent daemon/service/systemd-unit
````

## usage

In Element/Riot start a chat with `@_instagrampuppet_bot:your.matrix.domain`. In this chat you can issue commands, and `help` will list all available commands.

To simply get started issue the following commands:

````
# connect to instagram
link your_instagram_username your_instagram_password

# enable puppeting, 
setmatrixtoken your_riot_element_accesstoken
````

That's it. Go have fun!
