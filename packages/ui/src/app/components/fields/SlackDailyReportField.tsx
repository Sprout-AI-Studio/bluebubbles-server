import React, { useState } from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    Input,
    Stack,
    Text,
    IconButton
} from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { showSuccessToast } from '../../utils/ToastUtils';
import { setConfigBulk } from '../../slices/ConfigSlice';
import { AiOutlineSave } from 'react-icons/ai';

export const SlackDailyReportField = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const reportHour: number = (useAppSelector(state => state.config.slack_daily_report_hour) ?? 9);
    const timezone: string = (useAppSelector(state => state.config.slack_daily_report_timezone) ?? 'America/New_York');

    const [newHour, setNewHour] = useState(reportHour);
    const [newTimezone, setNewTimezone] = useState(timezone);

    const saveReport = (): void => {
        dispatch(setConfigBulk([
            { name: 'slack_daily_report_hour', value: newHour },
            { name: 'slack_daily_report_timezone', value: newTimezone }
        ]));
        showSuccessToast({
            id: 'settings',
            duration: 4000,
            description: 'Successfully saved daily report settings!'
        });
    };

    return (
        <FormControl>
            <FormLabel>Daily Report</FormLabel>
            <Stack direction='row' align='center' spacing={4} flexWrap='wrap'>
                <Stack direction='column' spacing={1}>
                    <Text fontSize='sm'>Report Hour (0-23)</Text>
                    <Input
                        type='number'
                        size='sm'
                        width='8em'
                        min={0}
                        max={23}
                        value={newHour}
                        onChange={(e) => setNewHour(parseInt(e.target.value) || 0)}
                    />
                </Stack>
                <Stack direction='column' spacing={1}>
                    <Text fontSize='sm'>Timezone (IANA)</Text>
                    <Input
                        type='text'
                        size='sm'
                        width='16em'
                        placeholder='America/New_York'
                        value={newTimezone}
                        onChange={(e) => setNewTimezone(e.target.value)}
                    />
                </Stack>
                <IconButton
                    mt={5}
                    aria-label='Save daily report settings'
                    icon={<AiOutlineSave />}
                    onClick={saveReport}
                />
            </Stack>
            <FormHelperText>
                <Text>
                    A daily summary of sent and received message counts will be posted
                    to Slack at the configured hour in the specified timezone.
                </Text>
            </FormHelperText>
        </FormControl>
    );
};
