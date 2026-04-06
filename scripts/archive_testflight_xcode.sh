#!/bin/zsh

set -euo pipefail

ACTION="${1:-archive}"

case "$ACTION" in
  archive|archive-and-upload)
    ;;
  *)
    echo "Usage: zsh ./scripts/archive_testflight_xcode.sh [archive|archive-and-upload]"
    exit 1
    ;;
esac

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_PATH="${IOS_TESTFLIGHT_WORKSPACE_PATH:-$PROJECT_ROOT/apps/mobile/ios/DevAgent.xcworkspace}"
SCHEME_NAME="${IOS_TESTFLIGHT_SCHEME:-DevAgent}"
CONFIGURATION_NAME="${IOS_TESTFLIGHT_CONFIGURATION:-Release}"
DESTINATION_NAME="${IOS_TESTFLIGHT_DESTINATION:-generic/platform=iOS}"
ARTIFACTS_ROOT="${IOS_TESTFLIGHT_ARTIFACTS_DIR:-$PROJECT_ROOT/artifacts/testflight}"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
RUN_DIR="$ARTIFACTS_ROOT/$TIMESTAMP"
ARCHIVE_BASENAME="${IOS_TESTFLIGHT_ARCHIVE_BASENAME:-DevAgent}"
ARCHIVE_PATH="$RUN_DIR/${ARCHIVE_BASENAME}.xcarchive"
EXPORT_PATH="$RUN_DIR/export"
EXPORT_OPTIONS_PLIST="$RUN_DIR/ExportOptions.plist"
ALLOW_PROVISIONING_UPDATES="${IOS_TESTFLIGHT_ALLOW_PROVISIONING_UPDATES:-1}"
DRY_RUN="${IOS_TESTFLIGHT_DRY_RUN:-0}"
TEAM_ID="${IOS_TESTFLIGHT_TEAM_ID:-}"
INTERNAL_ONLY="${IOS_TESTFLIGHT_INTERNAL_ONLY:-0}"
MANAGE_VERSION_AND_BUILD="${IOS_TESTFLIGHT_MANAGE_VERSION_AND_BUILD:-1}"
AUTH_KEY_PATH="${IOS_TESTFLIGHT_AUTH_KEY_PATH:-$HOME/Downloads/AuthKey_AF57SB66R8.p8}"
AUTH_KEY_ID="${IOS_TESTFLIGHT_AUTH_KEY_ID:-}"
AUTH_KEY_ISSUER_ID="${IOS_TESTFLIGHT_AUTH_KEY_ISSUER_ID:-${ASC_ISSUER_ID:-7e44cb92-9e2c-4400-aa10-1c7cf0c70702}}"

export EXPO_NO_DOTENV="${EXPO_NO_DOTENV:-1}"
unset EXPO_PUBLIC_DEV_AGENT_API_URL
unset EXPO_PUBLIC_DEV_AGENT_WS_URL

mkdir -p "$RUN_DIR"

run_cmd() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'

  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi

  "$@"
}

append_optional_args() {
  if [ "$ALLOW_PROVISIONING_UPDATES" = "1" ]; then
    OPTIONAL_XCODEBUILD_ARGS+=("-allowProvisioningUpdates")
  fi
}

append_export_plist_bool() {
  local key="$1"
  local value="$2"

  if [ "$value" = "1" ]; then
    EXPORT_PLIST_LINES+=("  <key>${key}</key>")
    EXPORT_PLIST_LINES+=("  <true/>")
  else
    EXPORT_PLIST_LINES+=("  <key>${key}</key>")
    EXPORT_PLIST_LINES+=("  <false/>")
  fi
}

typeset -a OPTIONAL_XCODEBUILD_ARGS
typeset -a ARCHIVE_COMMAND
typeset -a EXPORT_COMMAND
typeset -a EXPORT_PLIST_LINES

append_optional_args

if [ -z "$AUTH_KEY_ID" ] && [[ "$(basename "$AUTH_KEY_PATH")" =~ ^AuthKey_([A-Z0-9]+)\.p8$ ]]; then
  AUTH_KEY_ID="${match[1]}"
fi

ARCHIVE_COMMAND=(
  xcodebuild
  -workspace "$WORKSPACE_PATH"
  -scheme "$SCHEME_NAME"
  -configuration "$CONFIGURATION_NAME"
  -destination "$DESTINATION_NAME"
  -archivePath "$ARCHIVE_PATH"
)
ARCHIVE_COMMAND+=("${OPTIONAL_XCODEBUILD_ARGS[@]}")
ARCHIVE_COMMAND+=(archive)

cat <<EOF > "$RUN_DIR/summary.txt"
action=$ACTION
workspace=$WORKSPACE_PATH
scheme=$SCHEME_NAME
configuration=$CONFIGURATION_NAME
destination=$DESTINATION_NAME
run_dir=$RUN_DIR
archive_path=$ARCHIVE_PATH
expo_no_dotenv=$EXPO_NO_DOTENV
auth_key_path=$AUTH_KEY_PATH
auth_key_id=$AUTH_KEY_ID
auth_key_issuer_id=$AUTH_KEY_ISSUER_ID
EOF

run_cmd "${ARCHIVE_COMMAND[@]}"

if [ "$ACTION" = "archive" ]; then
  cat <<EOF
Archive created successfully.
run_dir=$RUN_DIR
archive_path=$ARCHIVE_PATH
summary_path=$RUN_DIR/summary.txt
EOF
  exit 0
fi

USE_API_KEY_AUTH="0"
if [ -n "$AUTH_KEY_ISSUER_ID" ]; then
  if [ ! -f "$AUTH_KEY_PATH" ]; then
    echo "App Store Connect API key file not found at: $AUTH_KEY_PATH" >&2
    exit 1
  fi

  if [ -z "$AUTH_KEY_ID" ]; then
    echo "Could not determine the App Store Connect API key ID. Set IOS_TESTFLIGHT_AUTH_KEY_ID." >&2
    exit 1
  fi

  USE_API_KEY_AUTH="1"
elif [ -f "$AUTH_KEY_PATH" ]; then
  cat <<EOF >&2
Found App Store Connect API key at:
  $AUTH_KEY_PATH

But the issuer ID is missing.
Set IOS_TESTFLIGHT_AUTH_KEY_ISSUER_ID (or ASC_ISSUER_ID) and rerun.
EOF
  exit 1
fi

EXPORT_PLIST_LINES=(
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
  "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">"
  "<plist version=\"1.0\">"
  "<dict>"
  "  <key>destination</key>"
  "  <string>upload</string>"
  "  <key>method</key>"
  "  <string>app-store-connect</string>"
  "  <key>signingStyle</key>"
  "  <string>automatic</string>"
)

if [ -n "$TEAM_ID" ]; then
  EXPORT_PLIST_LINES+=("  <key>teamID</key>")
  EXPORT_PLIST_LINES+=("  <string>${TEAM_ID}</string>")
fi

append_export_plist_bool "manageAppVersionAndBuildNumber" "$MANAGE_VERSION_AND_BUILD"
append_export_plist_bool "testFlightInternalTestingOnly" "$INTERNAL_ONLY"
append_export_plist_bool "uploadSymbols" "1"

EXPORT_PLIST_LINES+=(
  "</dict>"
  "</plist>"
)

printf '%s\n' "${EXPORT_PLIST_LINES[@]}" > "$EXPORT_OPTIONS_PLIST"

EXPORT_COMMAND=(
  xcodebuild
  -exportArchive
  -archivePath "$ARCHIVE_PATH"
  -exportPath "$EXPORT_PATH"
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"
)
EXPORT_COMMAND+=("${OPTIONAL_XCODEBUILD_ARGS[@]}")

if [ "$USE_API_KEY_AUTH" = "1" ]; then
  EXPORT_COMMAND+=(
    -authenticationKeyPath "$AUTH_KEY_PATH"
    -authenticationKeyID "$AUTH_KEY_ID"
    -authenticationKeyIssuerID "$AUTH_KEY_ISSUER_ID"
  )
fi

run_cmd "${EXPORT_COMMAND[@]}"

cat <<EOF >> "$RUN_DIR/summary.txt"
export_path=$EXPORT_PATH
export_options_plist=$EXPORT_OPTIONS_PLIST
EOF

cat <<EOF
Archive uploaded successfully.
run_dir=$RUN_DIR
archive_path=$ARCHIVE_PATH
export_path=$EXPORT_PATH
export_options_plist=$EXPORT_OPTIONS_PLIST
summary_path=$RUN_DIR/summary.txt
EOF
