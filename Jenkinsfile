#!/usr/bin/env groovy

ansiColor('xterm') {
  node('executor') {
    checkout scm
    load 'packages/orthogonal/Jenkinsfile'
  }
}
