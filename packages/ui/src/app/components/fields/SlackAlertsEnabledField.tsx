import React from 'react';
import {
    FormControl,
    FormHelperText,
    Checkbox,
    Text
} from '@chakra-ui/react';
import { useAppSelector } from '../../hooks';
import { onCheckboxToggle } from '../../actions/ConfigActions';

export const SlackAlertsEnabledField = (): JSX.Element => {
    const enabled: boolean = (useAppSelector(state => state.config.slack_alerts_enabled) ?? false);

    return (
        <FormControl>
            <Checkbox id='slack_alerts_enabled' isChecked={enabled} onChange={onCheckboxToggle}>
                Enable Slack Alerts
            </Checkbox>
            <FormHelperText>
                <Text>
                    When enabled, BlueBubbles will send alerts to a Slack channel when
                    connectivity issues or activity anomalies are detected.
                </Text>
            </FormHelperText>
        </FormControl>
    );
};
