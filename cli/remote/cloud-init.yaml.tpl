#cloud-config
package_update: true
packages: [jq, curl, cron]
write_files:
  - path: /etc/fcx/name
    content: "@NAME@\n"
  - path: /etc/fcx/deadline
    content: "@DEADLINE@\n"
  - path: /opt/fcx/lib.sh
    encoding: b64
    content: "@LIB_B64@"
  # TTL-BEGIN
  - path: /usr/local/bin/fcx-ttl-destroy
    permissions: "0755"
    encoding: b64
    content: "@TTL_B64@"
  - path: /etc/cron.d/fcx-ttl
    content: "*/5 * * * * root /usr/local/bin/fcx-ttl-destroy >> /var/log/fcx-ttl.log 2>&1\n"
  # TTL-END
