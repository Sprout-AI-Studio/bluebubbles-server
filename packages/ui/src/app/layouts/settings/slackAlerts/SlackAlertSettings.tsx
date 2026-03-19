import React from 'react';
import {
    Divider,
    Stack,
    Text,
    Spacer
} from '@chakra-ui/react';
import { SlackAlertsEnabledField } from '../../../components/fields/SlackAlertsEnabledField';
import { SlackWebhookUrlField } from '../../../components/fields/SlackWebhookUrlField';
import { SlackChannelField } from '../../../components/fields/SlackChannelField';
import { SlackAlertThresholdsField } from '../../../components/fields/SlackAlertThresholdsField';
import { SlackDailyReportField } from '../../../components/fields/SlackDailyReportField';
import { SlackAlertCustomMessageField } from '../../../components/fields/SlackAlertCustomMessageField';
import { SlackAlertMessageFilterField } from '../../../components/fields/SlackAlertMessageFilterField';

export const SlackAlertSettings = (): JSX.Element => {
    return (
        <section>
            <Stack direction='column' p={5}>
                <Text fontSize='2xl'>Slack Alerts</Text>
                <Divider orientation='horizontal' />
                <Spacer />
                <SlackAlertsEnabledField />
                <Spacer />
                <SlackWebhookUrlField />
                <Spacer />
                <SlackChannelField />
                <Spacer />
                <SlackAlertMessageFilterField />
                <Spacer />
                <SlackAlertThresholdsField />
                <Spacer />
                <SlackDailyReportField />
                <Spacer />
                <SlackAlertCustomMessageField />
            </Stack>
        </section>
    );
};
