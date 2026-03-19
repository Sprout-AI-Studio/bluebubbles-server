import React from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    Select,
    Text
} from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { setConfig } from '../../slices/ConfigSlice';

export const SlackAlertMessageFilterField = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const filter: string = (useAppSelector(state => state.config.slack_alert_message_filter) ?? 'all');

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        dispatch(setConfig({ name: 'slack_alert_message_filter', value: e.target.value }));
    };

    return (
        <FormControl>
            <FormLabel htmlFor='slack_alert_message_filter'>Message Type Filter</FormLabel>
            <Select
                id='slack_alert_message_filter'
                maxWidth='20em'
                value={filter}
                onChange={handleChange}
            >
                <option value='all'>All (iMessage + SMS + RCS)</option>
                <option value='SMS'>SMS Only</option>
                <option value='iMessage'>iMessage Only</option>
            </Select>
            <FormHelperText>
                <Text>
                    Filter which message types trigger no-receive and no-send alerts.
                    In production, you may want SMS only to monitor forwarding health.
                </Text>
            </FormHelperText>
        </FormControl>
    );
};
