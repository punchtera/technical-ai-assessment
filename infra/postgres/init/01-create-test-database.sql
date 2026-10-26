-- Runs once, when the Docker volume is first created.
-- A separate database keeps integration tests from touching development data.
CREATE DATABASE fis_test OWNER fis;
