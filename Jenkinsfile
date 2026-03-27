#!/usr/bin/env groovy

ansiColor('xterm') {
  node('executor') {
    stage("Checkout monorepo and load jobs") {
      checkout scm
      load 'packages/orthogonal/Jenkinsfile'
    }
  }
}
