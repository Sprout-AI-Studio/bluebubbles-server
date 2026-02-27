import React, { useEffect, useState } from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    FormErrorMessage,
    Input,
    IconButton,
    Flex
} from '@chakra-ui/react';
import { AiOutlineSave } from 'react-icons/ai';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { showSuccessToast } from '../../utils/ToastUtils';
import { setConfig } from '../../slices/ConfigSlice';

export const CustomEnvironmentField = (): JSX.Element => {
    const dispatch = useAppDispatch();

    const saved: string = useAppSelector(state => state.config.custom_environment) ?? '';
    const [value, setValue] = useState(saved);
    const [error, setError] = useState('');
    const hasError = error.length > 0;

    useEffect(() => {
        setValue(saved);
    }, [saved]);

    const save = (newValue: string): void => {
        newValue = newValue.trim();
        if (newValue === saved) {
            setError('No change since last save.');
            return;
        }

        dispatch(setConfig({ name: 'custom_environment', value: newValue }));
        if (hasError) setError('');
        showSuccessToast({
            id: 'settings',
            duration: 4000,
            description: 'Successfully saved environment label!'
        });
    };

    return (
        <FormControl isInvalid={hasError}>
            <FormLabel htmlFor='custom_environment'>Environment Label</FormLabel>
            <Flex flexDirection='row' justifyContent='flex-start' alignItems='center'>
                <Input
                    id='custom_environment'
                    type='text'
                    maxWidth='20em'
                    placeholder='e.g. production, staging, john-mini'
                    value={value}
                    onChange={e => {
                        if (hasError) setError('');
                        setValue(e.target.value);
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter') save(value);
                    }}
                />
                <IconButton
                    ml={3}
                    verticalAlign='top'
                    aria-label='Save environment label'
                    icon={<AiOutlineSave />}
                    onClick={() => save(value)}
                />
            </Flex>
            {!hasError ? (
                <FormHelperText>
                    A short label shown on the server landing page (e.g. &quot;production&quot;, &quot;staging&quot;).
                    Defaults to the Node environment if left blank.
                </FormHelperText>
            ) : (
                <FormErrorMessage>{error}</FormErrorMessage>
            )}
        </FormControl>
    );
};
