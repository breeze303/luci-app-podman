include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Podman
LUCI_DEPENDS:=+luci-base +podman +rpcd +ucode-mod-socket

PKG_LICENSE:=AGPL-3.0
PKG_MAINTAINER:=luci-app-podman maintainers

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
