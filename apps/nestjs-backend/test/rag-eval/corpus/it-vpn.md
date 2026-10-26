# Remote access and VPN

## Installing the client

Everyone who works outside the office uses the WireGuard client. Download it from the official WireGuard site for macOS, Windows or Linux. Your personal tunnel configuration is issued by the self-service portal at portal.internal under "My devices". Each laptop gets its own configuration; never copy one between machines.

## Connecting

Open WireGuard, import the configuration file and switch the tunnel on. The status turns green within a few seconds. Internal services such as the wiki, Grafana and the database admin tools are only reachable while the tunnel is up.

## Troubleshooting

If the client shows error E-HANDSHAKE-17, the handshake failed because the laptop clock is off by more than two minutes. Turn on automatic time synchronisation and reconnect. If the tunnel connects but internal names do not resolve, set the DNS server to 10.20.0.2 in the configuration. Persistent problems go to the IT queue with the client log attached.

## Split tunnelling

Only traffic to internal networks goes through the tunnel. Video calls and ordinary browsing use your own internet connection, which keeps calls smooth. Do not change the AllowedIPs line to route everything through the office.
