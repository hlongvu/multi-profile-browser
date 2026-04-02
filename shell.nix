{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs
    pkgs.electron
  ];
  shellHook = ''
    export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron}/bin"
  '';
}
