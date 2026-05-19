#!/usr/bin/env bash
#
# Build pi binaries for all platforms locally.
# Mirrors .github/workflows/build-binaries.yml
#
# Usage:
#   ./scripts/build-binaries.sh [--skip-deps] [--platform <platform>]
#
# Options:
#   --skip-deps         Skip installing cross-platform dependencies
#   --platform <name>   Build only for specified platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64)
#
# Output:
#   packages/coding-agent/binaries/
#     pi-darwin-arm64.tar.gz
#     pi-darwin-x64.tar.gz
#     pi-darwin-arm64.dmg
#     pi-darwin-x64.dmg
#     pi-linux-x64.tar.gz
#     pi-linux-arm64.tar.gz
#     pi-windows-x64.zip
#     pi-windows-arm64.zip

set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_DEPS=false
PLATFORM=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate platform if specified
if [[ -n "$PLATFORM" ]]; then
    case "$PLATFORM" in
        darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64|windows-arm64)
            ;;
        *)
            echo "Invalid platform: $PLATFORM"
            echo "Valid platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64"
            exit 1
            ;;
    esac
fi

echo "==> Installing dependencies..."
npm ci

if [[ "$SKIP_DEPS" == "false" ]]; then
    echo "==> Installing cross-platform native bindings..."
    # npm ci only installs optional deps for the current platform
    # We need all platform bindings for bun cross-compilation
    # Use --force to bypass platform checks (os/cpu restrictions in package.json)
    # Install all in one command to avoid npm removing packages from previous installs
    npm install --no-save --force --ignore-scripts \
        @mariozechner/clipboard-darwin-arm64@0.3.2 \
        @mariozechner/clipboard-darwin-x64@0.3.2 \
        @mariozechner/clipboard-linux-x64-gnu@0.3.2 \
        @mariozechner/clipboard-linux-arm64-gnu@0.3.2 \
        @mariozechner/clipboard-win32-x64-msvc@0.3.2 \
        @mariozechner/clipboard-win32-arm64-msvc@0.3.2 \
        @img/sharp-darwin-arm64@0.34.5 \
        @img/sharp-darwin-x64@0.34.5 \
        @img/sharp-linux-x64@0.34.5 \
        @img/sharp-linux-arm64@0.34.5 \
        @img/sharp-win32-x64@0.34.5 \
        @img/sharp-win32-arm64@0.34.5 \
        @img/sharp-libvips-darwin-arm64@1.2.4 \
        @img/sharp-libvips-darwin-x64@1.2.4 \
        @img/sharp-libvips-linux-x64@1.2.4 \
        @img/sharp-libvips-linux-arm64@1.2.4
else
    echo "==> Skipping cross-platform native bindings (--skip-deps)"
fi

echo "==> Building all packages..."
npm run build
npm run build --prefix packages/web-ui/example

echo "==> Building binaries..."
cd packages/coding-agent

# Clean previous builds
rm -rf binaries
mkdir -p binaries/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64,windows-arm64}

# Determine which platforms to build
if [[ -n "$PLATFORM" ]]; then
    PLATFORMS=("$PLATFORM")
else
    PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64 windows-arm64)
fi

for platform in "${PLATFORMS[@]}"; do
    echo "Building for $platform..."
    # Externalize koffi to avoid embedding all 18 platform .node files (~74MB)
    # into every binary. Koffi is only used on Windows for VT input and the
    # call site has a try/catch fallback. For Windows builds, we copy the
    # appropriate .node file alongside the binary below.
    if [[ "$platform" == windows-* ]]; then
        bun build --compile --external koffi --target=bun-$platform ./dist/bun/cli.js --outfile binaries/$platform/pi.exe
    else
        bun build --compile --external koffi --target=bun-$platform ./dist/bun/cli.js --outfile binaries/$platform/pi
    fi
done

echo "==> Creating release archives..."

# Copy shared files to each platform directory
for platform in "${PLATFORMS[@]}"; do
    cp package.json binaries/$platform/
    cp README.md binaries/$platform/
    cp CHANGELOG.md binaries/$platform/
    cp ../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm binaries/$platform/
    mkdir -p binaries/$platform/theme
    cp dist/modes/interactive/theme/*.json binaries/$platform/theme/
    mkdir -p binaries/$platform/assets
    cp dist/modes/interactive/assets/* binaries/$platform/assets/
    cp -r dist/core/export-html binaries/$platform/
    mkdir -p binaries/$platform/web-ui
    cp -r ../web-ui/example/dist/* binaries/$platform/web-ui/
    cp -r docs binaries/$platform/
    cp -r examples binaries/$platform/

    # Copy koffi native module for Windows (needed for VT input support)
    if [[ "$platform" == windows-* ]]; then
        if [[ "$platform" == "windows-arm64" ]]; then
            koffi_arch_dir="win32_arm64"
        else
            koffi_arch_dir="win32_x64"
        fi
        mkdir -p binaries/$platform/node_modules/koffi/build/koffi/$koffi_arch_dir
        cp ../../node_modules/koffi/index.js binaries/$platform/node_modules/koffi/
        cp ../../node_modules/koffi/package.json binaries/$platform/node_modules/koffi/
        cp ../../node_modules/koffi/build/koffi/$koffi_arch_dir/koffi.node binaries/$platform/node_modules/koffi/build/koffi/$koffi_arch_dir/
    fi

    if [[ "$platform" == darwin-* ]]; then
        app_dir="binaries/$platform/Pi Web.app"
        echo "Creating Pi Web.app for $platform..."
        if command -v swiftc &> /dev/null; then
            mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
            swiftc -parse-as-library src/macos/PiWebMenuBar.swift -o "$app_dir/Contents/MacOS/PiWebMenuBar" -framework AppKit -framework ApplicationServices
            cp "binaries/$platform/pi" "$app_dir/Contents/MacOS/pi"
            cp "binaries/$platform/package.json" "$app_dir/Contents/MacOS/"
            cp "binaries/$platform/photon_rs_bg.wasm" "$app_dir/Contents/MacOS/"
            cp -r "binaries/$platform/theme" "$app_dir/Contents/MacOS/theme"
            cp -r "binaries/$platform/assets" "$app_dir/Contents/MacOS/assets"
            cp -r "binaries/$platform/export-html" "$app_dir/Contents/MacOS/export-html"
            cp -r "binaries/$platform/web-ui" "$app_dir/Contents/MacOS/web-ui"
            cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
        <key>CFBundleExecutable</key>
        <string>PiWebMenuBar</string>
        <key>CFBundleIdentifier</key>
        <string>works.earendil.pi.web</string>
        <key>CFBundleName</key>
        <string>Pi Web</string>
        <key>CFBundleDisplayName</key>
        <string>Pi Web</string>
        <key>CFBundlePackageType</key>
        <string>APPL</string>
        <key>CFBundleShortVersionString</key>
        <string>0.75.3</string>
        <key>CFBundleVersion</key>
        <string>0.75.3</string>
        <key>LSUIElement</key>
        <true/>
        <key>NSAppleEventsUsageDescription</key>
        <string>Pi Web can run local automation commands when you grant permission.</string>
</dict>
</plist>
PLIST
            chmod +x "$app_dir/Contents/MacOS/PiWebMenuBar" "$app_dir/Contents/MacOS/pi"
            if command -v codesign &> /dev/null; then
                codesign --force --deep --sign - "$app_dir" || true
            fi
        else
            echo "Skipping Pi Web.app: swiftc not found"
        fi
    fi
done

# Create archives
cd binaries

for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        # Windows (zip)
        echo "Creating pi-$platform.zip..."
        (cd $platform && zip -r ../pi-$platform.zip .)
    elif [[ "$platform" == darwin-* ]]; then
        # macOS (dmg + tar.gz)
        echo "Creating pi-$platform.tar.gz..."
        mv $platform pi && tar -czf pi-$platform.tar.gz pi && mv pi $platform

        echo "Creating pi-$platform.dmg..."
        if command -v hdiutil &> /dev/null; then
            rm -rf "${platform}-dmg-staging"
            mkdir -p "${platform}-dmg-staging"
            cp -r "$platform/Pi Web.app" "${platform}-dmg-staging/"
            ln -s /Applications "${platform}-dmg-staging/Applications"
            hdiutil create -volname "Pi Web" -srcfolder "${platform}-dmg-staging" -ov -format UDZO "pi-$platform.dmg"
            rm -rf "${platform}-dmg-staging"
        else
            echo "Skipping .dmg creation: hdiutil not found"
        fi
    else
        # Unix platforms (tar.gz) - use wrapper directory for mise compatibility
        echo "Creating pi-$platform.tar.gz..."
        mv $platform pi && tar -czf pi-$platform.tar.gz pi && mv pi $platform
    fi
done

# Extract archives for easy local testing
echo "==> Extracting archives for testing..."
for platform in "${PLATFORMS[@]}"; do
    rm -rf $platform
    if [[ "$platform" == windows-* ]]; then
        mkdir -p $platform && (cd $platform && unzip -q ../pi-$platform.zip)
    else
        tar -xzf pi-$platform.tar.gz && mv pi $platform
    fi
done

echo ""
echo "==> Build complete!"
echo "Archives available in packages/coding-agent/binaries/"
ls -lh *.tar.gz *.zip *.dmg 2>/dev/null || true
echo ""
echo "Extracted directories for testing:"
for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        echo "  binaries/$platform/pi.exe"
    else
        echo "  binaries/$platform/pi"
    fi
done
