[![Support room on Matrix](https://img.shields.io/matrix/mx-puppet-bridge:sorunome.de.svg?label=%23mx-puppet-bridge%3Asorunome.de&logo=matrix&server_fqdn=sorunome.de)](https://matrix.to/#/#mx-puppet-bridge:sorunome.de) [![donate](https://liberapay.com/assets/widgets/donate.svg)](https://liberapay.com/Sorunome/donate)

# mx-puppet-instagram
This is an instagram puppeting bridge for matrix. It is based on [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge).

## Install Instructions (from Source)
* Clone and install:
  ```
  git clone https://github.com/Sorunome/mx-puppet-instagram.git
  cd mx-puppet-instagram
  npm install
  ```
* Modify the configuration file
* Generate the registration file
  ```
  npm run start -- -r
  ```
* Add the registration file to the list under `app_service_config_files:` in your synapse config.
* Restart synapse
* Start the bridge:
  ```
  npm run start
  ```
* Start a direct chat with the bot user (`@_instagrampuppet_bot:domain.tld` unless you changed the config).
  (Give it some time after the invite, it'll join after a minute maybe.)
* Get your Instagram username and password as below, and tell the bot user to link your Instagram account:
  ```
  link <username> <password>
  ```
## Run as systemd service
* create a systemd service file `mx-puppet-instagram.service` and modify according to your setup:
  ```
  [Unit]
  Description=Instagram bridge for matrix homeserver
  After=network.target

  [Service]
  ExecStart=/usr/bin/npm run start
  WorkingDirectory=/path/to/mx-puppet-instagram
  Environment=NODE_ENV=production

  Restart=always
  RestartSec=60

  StandardOutput=syslog
  StandardError=syslog
  SyslogIdentifier=mx-puppet-instagram

  User=Bridge-User
  Group=Bridge-Group

  [Install]
  WantedBy=default.target
  ```
* Reload systemd
  ```
  systemctl daemon-reload
  ```
* Enable Bridge service
  ```
  systemctl enable mx-puppet-instagram.service
  ```
* Start the Bridge
  ```
  systemctl start mx-puppet-instagram.service
  ```
